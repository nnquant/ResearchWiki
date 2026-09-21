# 前端与 Agent 接入层性能优化建议（2026-09-21）

结论：网页打开慢和 Agent 调用失败有共同根因，不是网络或前端渲染本身。本机实测（服务已运行数日、缓存已热）：

| 入口 | 端点 / 操作 | 实测 | 说明 |
| --- | --- | ---: | --- |
| 网页 | `GET /api/status`（每个标签页每 30 秒轮询） | 2.1–2.4 s | 每次读取并解析 167 MB 的 `state/manifest.json` |
| 网页 | `GET /api/index`（侧栏树、命令面板，每次进入页面） | 4.6 s，**24.5 MB** | 18,325 页全部元数据 + 摘要一次性下发 |
| 网页 | `GET /api/home` | 10.6–14.0 s | 内部两次构建全库索引 |
| 网页 | `GET /api/types` / `/api/tags` | 4.4 s / 5.9 s（3.7 MB） | 同样走全库索引 |
| 网页 | `GET /api/pages?limit=50` | 5.4 s | 先全库索引再内存分页 |
| 网页 | `GET /api/search?mode=fast` | 10.6 s | fast 实际映射为 hybrid，向量阶段固定超时 5 s |
| 网页 | `GET /api/graph-navigation` | **41 ms** | 只读 YAML 头、增量缓存——证明正确做法可行 |
| Agent | `describe` | 0.8 s | |
| Agent | `query limit=5` | 5.3–9.2 s | 先取全部 18,327 条引用再分页 |
| Agent | `search lexical "加息 AI"` | 5.6 s | coverage 0.8 s + 正文 SQL 4.65 s；召回 17,620/18,327 份 |
| Agent | `search hybrid "加息 AI"` | 7.1 s，degraded | 向量阶段 5 s 超时（embedding 本身仅 0.3 s） |
| Agent | `search hybrid` + 标签过滤 | 12.9 s，degraded | coverage 4.4 s + lexical 3.3 s + 向量超时 5 s |

Agent 默认查询预算 15 s、客户端等待 18 s；上表中带过滤的 hybrid 在有并发或后台任务时就会越过预算，表现为 `TIMEOUT` / HTTP 504 / 空结果。所有响应还固定带 `degraded: index_incomplete`，Agent 无法区分"索引真的没建好"和"3 份材料含非法字符"。

以下先给根因，再按优先级给改动建议与验收标准。本文只提建议，未修改代码或配置。

## 1. 根因

### 1.1 全库元数据在每个请求里重新构建（网页慢的主因）

- `scripts/server/pages-service.mjs` 的 `getIndex()` 为 `/api/index`、`/api/home`、`/api/types`、`/api/tags`、`/api/pages` 共用。它每次调用 `scanWiki()`（对 18,325 个文件逐个 `fs.stat`，5 秒 TTL）、`db.listIndex()`（全表 + 反链子查询 + 标签聚合），再按行顺序 `await pageMeta()`，串行且每行调用 4 次。
- `pageMeta` 需要读入**整篇正文**来算 200 字摘要，wiki 目录共 1.3 GB，单文件最大 1.7 MB。mtime 缓存只在进程内，重启后要冷读整库；缓存本身也是 Node 进程常驻 1.6 GB 的主要来源之一。
- `homeData()` 调 `getIndex()` 后又调 `typesWithCounts()`，后者再调一次 `getIndex()`。
- 结果对象没有任何结果级缓存：同一秒内 5 个请求各自完整重算、各自序列化 24.5 MB。

### 1.2 167 MB 的 manifest.json 被当作配置读

- `common.mjs` 的 `manifest()` 是 `readJson(manifestPath)`，无缓存。文件 167 MB、18,323 条、平均 7.4 KB/条，其中 `article_metadata` 占 50 MB、`llm` 占 13 MB。
- 读取方：`/api/status`（前端每 30 s 轮询一次，多标签页叠加）、`/api/stats`、每个文献页的 `provenanceFor()`（读完再对 18k 条做线性 `find`）、后台 `buildIndex()` 每 5 分钟一次。
- 单次读+解析约 0.6 s，但会产生数百 MB 的临时对象，触发 GC 停顿，拖慢同一事件循环里所有并发请求。文献整理 worker 每 10 分钟左右还会整体重写这个文件。

### 1.3 数据库缓存严重不足，主机内存已耗尽

| 项目 | 现值 | 说明 |
| --- | --- | --- |
| 数据库总大小 | 23 GB | `content_chunks` 14 GB（HNSW 索引 6.3 GB）、`research_query.blocks` 6.5 GB |
| `shared_buffers` | 128 MB | 默认值，约为数据量的 0.5% |
| `work_mem` / `effective_cache_size` / `jit` | 4 MB / 4 GB / on | 默认值 |
| 缓冲区命中率 | 43% | `pg_statio_user_tables` 累计 |
| `count(*) content_chunks` | 60 s | 说明表级顺序读几乎全部落盘 |
| 主机 RAM | 30 GB，**空闲 1.1 GB** | wiki 1.6 GB、gbrain(bun) 1.7 GB、报告监听 0.9 GB、整理 worker 1.1 GB、WSL2 上限 14.5 GB |
| Postgres 容器 | 263 MiB | 没有独立内存限制，但受 shared_buffers 约束 |

主机没有空闲内存留给操作系统页缓存，Postgres 自身缓存又只有 128 MB，所以 coverage 统计、lexical 召回、向量精确扫描每次都从虚拟磁盘重读。上面 `coverage_ms` 从 0.8 s 波动到 4.4 s 就是同一条 SQL 在缓存冷热不同时的差异。

### 1.4 Agent 查询层的固定开销与超时结构

- **coverage 每请求必算**：`store.coverage()` 对 `documents` 全表顺序扫描 + 与 `search_documents` 哈希连接，只有在索引任务运行后才会变化，却在每次 describe/query/search/read 之前都执行。
- **hybrid 的向量阶段必定超时**：`vectorCandidates` 对过滤集合做**精确**余弦排序（`MATERIALIZED eligible`），无过滤时要扫 100 万条 1024 维向量。远端 embedding 仅 0.3 s，剩余 4.7 s 全部耗在扫描，5 s 预算下无论有无过滤都超时。网页 "fast" 模式映射为 hybrid，因此网页搜索每次白等 5 s。
- **中文单字 OR 召回**：`contract.tsQuery` 用 `Intl.Segmenter` 分词后按 OR 连接，"加息 AI" 生成 `'加' | '息' | 'ai'`，命中 96% 的材料（17,620/18,327），候选阶段的排序代价与语义无关地被放大。上次优化把它压到 5 s 内，但仍是最大的单项开销。
- **query 先物化全量**：`listDocuments(limit: 100001)` 取回全部引用，`saveSession` 对整份 payload `JSON.stringify` 计算字节，`paginate` 再 stringify 一次；18k 条时仅这两次序列化就是数百毫秒，并常驻 session 缓存（上限 32 MB）。
- **准入与连接池不匹配**：Agent 入口允许 8 并发，读取池和 FIFO 闸门只有 4；第 5–8 个请求在闸门排队，排队时间计入 15 s 预算，排到时可能只剩几秒。8018 上的 `/api/research/*` 与网页搜索不受这个计数约束，却共用同一个 4 连接池。
- **客户端等待 = 服务端预算 + 3 s**：`client.mjs` 的 `AbortSignal.timeout(timeout_ms + 3000)`；服务端在预算耗尽时返回 504，客户端同时到点，两边都报 TIMEOUT，没有降级结果可用。
- **永久 degraded**：3 份材料的元数据含 `\u0000`，写入 jsonb 失败（`22P05`），每 5 分钟重试并失败一次，`coverage.complete` 永远为 false，每个响应都带 `index_incomplete`。

### 1.5 静态资源与前端加载

- `web/dist` 共 29 MB、970 个文件，其中字体 26 MB。`index.css` 462 KB 内含 **960 条 `@font-face`**（Noto Sans / SC / Mono 各 4 个字重 × 全部 unicode-range 子集，含 devanagari 等无用脚本）。中文页面会按需触发几十个 50 KB 左右的字体请求，走 HTTP/1.1 的 6 连接排队。
- 首屏脚本：`index` 322 KB + `react` 442 KB + `katex` 270 KB（`modulepreload`，即使页面无公式）+ 两份 CSS，共约 1.5 MB 未压缩。`routes/static.mjs` 每次请求 `readFile` 整个文件，**不压缩、不带 ETag**，只有 `/app/` 下有 immutable 缓存头。
- 前端每次进入非图谱路由都请求 `/api/index`（24.5 MB，`staleTime` 60 s），命令面板在 18k 条上做客户端模糊匹配；资料库页再各请求一次 `/api/types`、`/api/tags`。

### 1.6 可观测性不足，失败原因难以复盘

- `wiki.stderr.log` 由 `Start-Process -RedirectStandardError` 创建，每次重启**覆盖**；日志行没有时间戳；Agent 只记录 ≥ 1 s 的请求；8018 的研究路由和网页搜索完全不记录。当前日志里只有 17 条记录，无法回答"昨天哪些调用失败、失败在哪一阶段"。
- 后台 `buildIndex` 每 5 分钟读一次 167 MB manifest、stat 18k 文件、比对签名，与交互请求共用 `wiki-index` 连接池。

## 2. 优化建议（按优先级）

### P0：不改代码即可做，预计当天见效

1. **释放主机内存并给 Postgres 合理缓存。** 在 `compose.yaml` 的 postgres 服务加 `command` 参数（或 `postgresql.conf`）：`shared_buffers=3GB`、`effective_cache_size=8GB`、`work_mem=32MB`、`maintenance_work_mem=512MB`、`jit=off`、`random_page_cost=1.1`（NVMe）。同时在 `.wslconfig` 里为 WSL2 设置 `memory=12GB` 之类的上限，避免与 Windows 争抢；交互时段停掉或降低 `enrich-articles-worker` 和 `watch-report-ingestion` 的并发（两者常驻 2 GB）。验收：`pg_statio` 命中率从 43% 升到 90% 以上，`coverage_ms` 稳定在 200 ms 内。
2. **修复 3 份含 `\u0000` 的材料。** `index.mjs` 写入 jsonb 前对 `metadata`/`title` 做 `replace(/\u0000/g, '')`（或在 `metadataFor` 内统一清洗），重跑 `npm run research:index`。验收：`coverage.complete=true`，响应不再带 `index_incomplete`，`[research-index] 3 materials need retry` 消失。
3. **网页搜索默认 lexical。** `routes/search.mjs` 里 `fast` 暂改映射为 `lexical`，hybrid 由用户显式选择。验收：网页搜索从 10.6 s 降到 2 s 左右。

### P1：服务端热路径（网页秒开的关键）

4. **manifest 摘要化。** 在 `common.mjs` 增加按 mtime 缓存的 `manifest()`；`/api/status` 只需要 `documents/indexed/failed/pdf_pages` 四个计数，改由写入方维护 `state/manifest-summary.json`（或从缓存对象一次算出后随 mtime 失效）；`provenanceFor` 改用 `wiki_slug → doc` 的 Map 缓存，不再线性查找。中期把 `article_metadata`、`llm`、`history` 拆出 manifest（按文档存到 `parsed/<id>/meta.json` 或直接写入 `research_query.documents.metadata`），manifest 只保留登记信息，目标体积 < 10 MB。验收：`/api/status` < 100 ms，文献页 `/api/page` 不再随 manifest 大小变化。
5. **页面索引改为增量快照。** 参照 `graph-inventory.mjs` 的做法：只读 YAML 头（`readGraphHeader`），摘要优先取 `summary/abstract` 字段，没有摘要的文献不再为了 200 字去读整篇正文（或在导入/整理时把摘要写进 frontmatter）；扫描并行 8 路；把 `getIndex()` 的结果按"文件清单指纹 + 数据库 `max(updated_at)`"缓存，未变化时直接复用；`homeData` 和 `typesWithCounts` 共用同一份快照；把元数据缓存持久化到 `state/page-meta-cache.json`，重启即热。验收：`/api/home`、`/api/types`、`/api/tags`、`/api/pages` 首次 < 1 s，热态 < 200 ms。
6. **`/api/index` 瘦身并把侧栏切到轻量接口。** 侧栏树只需要每类最近 8 条 + 计数，这正是 `/api/graph-navigation`（41 ms）已经提供的；所有路由统一用它。命令面板改为服务端 `GET /api/pages?q=`（标题、别名、代码前缀匹配，返回 ≤ 20 条），不再下发 24.5 MB 做客户端模糊匹配。若仍需全量索引接口，去掉 `excerpt`、`research`、`aliases` 字段并加 gzip，目标 < 1 MB。验收：进入任一页面的接口总下载量 < 300 KB。
7. **静态资源压缩与缓存。** `routes/static.mjs` 启动时把 dist 读入内存（含预压缩的 `.br`/`.gz`，构建期用 `vite-plugin-compression` 生成），按 `accept-encoding` 直出；给 `index.html` 加 `ETag`；`/app/` 继续 immutable。验收：首屏传输量从约 1.5 MB 降到 400 KB 以内。

### P2：Agent 查询层（消除超时与失败）

8. **coverage 缓存。** 以 `(snapshot_id, filters 哈希)` 为键缓存 60 s，或在索引任务结束时预计算无过滤的 coverage 写入 `research_query.state`；有过滤时只做一次 `count`，不再重复取 `state`。验收：`coverage_ms` < 50 ms（缓存命中）。
9. **向量阶段改为"先召回后重排"。** 不再对整个过滤集合做精确扫描：只对 lexical 已经选出的候选文档（≤ 120/300 份，约几千个 chunk）做向量重排，成本有上限；无过滤或弱过滤的语义召回改走 HNSW 索引（pgvector ≥ 0.8 可用 `hnsw.iterative_scan=relaxed_order` 与 `hnsw.ef_search` 应对后过滤饥饿）。向量阶段预算降为 2–3 s，超时仍保留 lexical 结果并标记。验收：hybrid 不再出现 `embedding_or_vector: TIMEOUT`，p95 < 5 s。
10. **中文词组语义。** 当分词器把相邻单字切开（"加息"→"加""息"）时，用 `<->` 邻接查询把它们合成词组；多词查询默认要求**至少两个词项同时命中**（或先 AND 后 OR 回退），并在 `query_plan.lexical_match` 里显式声明，作为契约变更写入 `docs/agent-access.md`。验收："加息 AI" 的 `matched_documents` 从 17,620 降到千以内，`lexical_query_ms` < 1 s。
11. **query 改为键集分页。** 快照只保存 `(snapshot_id, filters, sort, 最后一条的排序键+document_id)`，每页一条带 `WHERE (sort_key, document_id) > (...) LIMIT n` 的 SQL；`total` 单独 `count` 并按 (filters, snapshot_id) 缓存；去掉对整份 payload 的两次 `JSON.stringify`，字节预算按逐项累加。验收：`query limit=5` < 500 ms，session 内存占用与页数无关。
12. **准入、预算、降级三者对齐。** `maxConcurrent` 与读取池同为 4（DB 调优后再一起放大到 6–8），8018 的研究路由与网页搜索纳入同一计数；超过时立刻 429 + `Retry-After`，不再进入闸门排队；`timeout_ms` 分阶段分配（coverage ≤ 0.5 s、lexical ≤ 8 s、vector ≤ 3 s、hydrate 余量），任何阶段超时都返回已得结果并在 `degraded` 标注，而不是整体 504。客户端 `client.mjs` 对 429/503/TIMEOUT 做一次指数退避重试（只读操作幂等），并把 `Retry-After` 透传给 CLI/MCP 调用方。
13. **请求日志可复盘。** 服务自己写 `logs/research-requests.jsonl`（追加、带时间戳、按天滚动），记录全部请求的 operation、状态码、各阶段耗时、排队时长、并发数，不记录查询正文与 token；8018 的研究路由与网页搜索同样记录；`/health` 增加数据库 ping、闸门队列深度、最近 5 分钟 p95。`start.ps1` 的重定向改为追加或改由服务写日志。验收：任何一次 Agent 失败都能在日志里找到阶段耗时。
14. **后台索引降频与错峰。** `refresh.mjs` 的 5 分钟改为 15 分钟，或改为监听 manifest/wiki 目录 mtime 后触发；有交互请求在闸门排队时推迟；manifest 走第 4 条的缓存后其读取成本自然下降。Token 文件按 mtime 缓存，避免每请求读盘（小项）。

### P3：前端构建

15. **字体。** 中文字体只保留 400/600 两个字重，并只引入 `chinese-simplified` 与 `latin` 子集（`@fontsource/noto-sans-sc/chinese-simplified-400.css` 之类），去掉 devanagari 等脚本；或直接用系统字体栈（Windows 用户为主时 `"Microsoft YaHei"`/`system-ui` 即可），字体请求从数十个降到个位数，`index.css` 缩到 100 KB 内。
16. **KaTeX 按需。** 去掉 `modulechunk` 的 `modulepreload`，`Markdown.tsx` 检测正文含 `$` 或 `\\(` 时再动态 `import('rehype-katex')` 与其 CSS；codemirror 已是懒加载，保持。
17. **数据获取。** react-query 中 `index/tags/types` 的 `staleTime` 提高到 5 分钟并在页面保存后失效；首页并行预取 `/api/home` 与 `/api/status`；资料库表格对 50 行内的标签渲染做截断（每行最多显示 6 个标签）。
18. **可选：反向代理提供 HTTP/2 + brotli。** 若日后放到 Caddy/Nginx 后面，第 7 条与字体多请求问题可以一并由代理解决；本机直连时仍需第 7 条。

## 3. 建议实施顺序与验收基准

| 阶段 | 内容 | 目标 |
| --- | --- | --- |
| 第 0 步（半天） | P0 三项：数据库参数、释放内存、修复 3 份材料、fast→lexical | Agent lexical p95 < 3 s；网页搜索 < 3 s；`complete=true` |
| 第 1 步（2–3 天） | P1 第 4–7 项 | `/api/status` < 100 ms；`/api/home` < 1 s；首屏接口下载 < 300 KB；静态传输 < 400 KB |
| 第 2 步（3–5 天） | P2 第 8–14 项 | describe < 300 ms；query 首页 < 500 ms；hybrid p95 < 5 s 且无向量超时；8 并发无 504；日志可回溯 |
| 第 3 步（1–2 天） | P3 | 字体请求 ≤ 6 个；无公式页面不加载 KaTeX |

每一步都用同一组固定用例回归：`describe`、`query limit=5`、`search lexical "加息 AI"`、`search hybrid "半导体 资本开支" --tag 行业:半导体`、8 并发 lexical、网页 `/api/home`、`/api/status`、`/api/pages?limit=50`，并保存到 `outputs/perf-YYYYMMDD.json` 与 `docs/agent-access-performance-2026-09-17.md` 的表格对比。测量应在后台 worker 暂停与运行两种状态下各做一次，避免把缓存冷热差异误判为改动效果。

## 4. 不建议的做法

- 只调高 `timeout_ms`、`requestTimeout` 或客户端等待：不会减少任何工作量，只会让失败来得更晚、并发堆积更多。
- 单独调高 `maxConcurrent` 或连接池：数据库缓存没扩大前，更多并发只会让每个请求更慢。
- 给 `content_chunks` 或 `blocks` 再加索引：现有 HNSW/GIN 已经 7 GB，问题是缓存与扫描范围，不是缺索引。
- 把 query 改成 OFFSET 分页：会破坏现有游标的版本一致性语义；键集分页才能同时保证正确性与性能。
- 悄悄把 lexical 改为 AND：召回语义是对外契约，需要在 `query_plan` 与文档中声明并给出回退。

## 5. 本次测量方式

- 网页接口：`curl` 直连 `127.0.0.1:8018`，两轮取值，第二轮为热缓存。
- Agent 接口：`curl` 带只读 token 直连 `127.0.0.1:8020`，`explain=true` 读取 `query_plan.timings`。
- 数据库：只读查询 `pg_settings`、`pg_class`、`pg_indexes`、`pg_statio_user_tables`、`EXPLAIN (ANALYZE, BUFFERS)`；未修改任何参数或数据。
- 主机：`Get-Process`、`docker stats`、`Win32_OperatingSystem`。
- 未做压测；并发相关结论来自代码与配置检查，实施后需按第 3 节的用例压测确认。
