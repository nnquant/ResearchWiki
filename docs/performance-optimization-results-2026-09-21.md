# 性能优化实施与验收（2026-09-21）

已按 [优化计划](performance-optimization-plan-2026-09-21.md) 实施数据库调优、网页元数据缓存、前端按需加载、查询分页与检索预算调整，并在实际 8018/8020 服务上验证。后台文章整理和报告监听已恢复；按用户选择保留现有 WSL 配置。

后续按用户要求恢复原字体，并裁剪字符集：Noto Sans 使用 Latin 的 400、500、600、700 字重，Noto Sans SC 使用中文简体的 400、500、600、700 字重，Noto Sans Mono 使用 Latin 的 400、500 字重，保留原字体栈。上述字重分别用于正文、控件/表格、标题和粗体；浏览器按实际渲染需要加载，不预加载全套字体。去掉其他语言子集，未覆盖字符由系统字体回退，font-display 保持 swap。其他优化保留，KaTeX 仍按需加载。下文系统字体、47.58 KB CSS、254 KB 初始静态资源及无 Noto 字体请求的记录为恢复字体前的测量，不代表恢复后的构建；接口和数据库基准不涉及字体资源。

恢复并裁剪后的主 CSS 为 50.03 KB（gzip 10.05 KB），只有 10 个字体声明；完整恢复全部语言子集时为 462.23 KB（gzip 148.83 KB）。中文简体 WOFF2 每字重约 1.14–1.17 MB，字体文件不计入前述 HTML/JS/CSS 体积；首次打开中文页面仍需下载用到的字体，后续使用 immutable 缓存。构建（含 TypeScript 检查）及静态资源压缩/HTTP 语义测试通过。

## 固定用例结果

下表旧值来自计划中的历史测量。本次开始时旧 Wiki 进程已退出，无法取得同轮有效基线；`outputs/perf-20260921-before.json` 保存连接失败，不用于计算提速倍数。新值为每组 3 次请求的最小值至最大值，单位 ms；小样本 p95 等于最大值，不能作为长期 SLA。

| 用例 | 计划历史值 | worker 暂停 | worker 运行 |
| --- | ---: | ---: | ---: |
| describe | 800 | 4–97 | 4–63 |
| query，limit=5 | 5,300–9,200 | 50–92 | 57–74 |
| lexical，加息 AI | 5,600 | 205–345 | 202–471 |
| hybrid，半导体 资本开支，行业:半导体 | 12,900，降级 | 577–920 | 588–1,042 |
| /api/home | 10,600–14,000 | 40–292 | 43–439 |
| /api/status | 2,100–2,400 | 3–5 | 3–22 |
| /api/pages?limit=50 | 5,400 | 19–44 | 24–26 |
| /api/graph-navigation | 41 | 34–41 | 33–45 |
| 网页 fast 搜索 | 10,600 | 207–225 | 201–206 |

两组单请求全部 HTTP 200，研究查询 `coverage.complete=true`，无 degraded。两组 8 并发各为 4 个 HTTP 200 和 4 个立即 429，无 504；运行 worker 时成功请求为 253–266 ms，拒绝请求为 6–8 ms。429 携带 Retry-After，表示共享准入生效，不能表述成“8 个请求全部成功”。基准直接调用 HTTP，不代替 CLI 的退避重试测试。

进程重启后的另一轮验证（PostgreSQL 和持久化元数据缓存仍热）为：首页 435 ms、query 70 ms、lexical 486 ms、hybrid 969 ms、网页 fast 227 ms，全部成功且无降级。这不是重启 Windows/WSL 或清空数据库缓存后的冷机基准。中间版本在完全冷缓存下出现过首页 14.7 秒及 lexical 超时，保留在 `outputs/perf-20260921-paused.json`，不能用热缓存结果承诺所有冷启动小于 1 秒。

## 实施内容与边界

| 计划项 | 实施结果 |
| --- | --- |
| 1 数据库与内存 | Compose 增加 1 GB shm；实际 Postgres 已加载 shared_buffers=3GB、effective_cache_size=8GB、work_mem=32MB、maintenance_work_mem=512MB、jit=off、random_page_cost=1.1。两个测量窗口的 heap buffer 命中率均为 100%（读盘增量 0），只代表该热缓存窗口。WSL 配置按用户选择保持不变，后台 worker 已恢复，文章整理并发为 1。 |
| 2 索引字符清洗 | 递归清洗 PostgreSQL 不支持的实际 NUL，保留字面转义字符串和源文件。重跑索引扫描 18,330 份，失败 0；第二轮增量 changed=0、failed=0。顺带修复 NTFS inode 超过 Number 精度导致独立 Wiki 页身份碰撞的问题。 |
| 3 fast | 网页 fast 明确使用 lexical，hybrid 由调用方显式选择。 |
| 4 manifest | 写入后维护小型 summary；读端按 mtime/ctime/size 缓存，provenance 使用 slug Map；写端仍取得独立可变副本。原有大 manifest 保留，拆分 article_metadata/llm/history 属于未实施的中期数据迁移。 |
| 5 页面快照 | 8 路扫描、只读 YAML 头、增量元数据持久化；按文件指纹和 DB count/max(updated_at) 复用结果，首页与分类共用。摘要取 frontmatter 的 summary/abstract，缺少摘要时不再读完整正文生成列表摘要。标签计数也随快照缓存。 |
| 6 轻量网页接口 | 侧栏、分类、标签控件使用轻量导航/有界标签接口；命令面板和编辑补全向服务器查最多 20 条，链接校验按目标 slug 批量查询，悬停摘要按需加载。遗留 /api/index 仅保留 slug/title/type/category/updated_at 并 gzip，但全量传输仍约 1.42 MB，未达到计划 <1 MB；主要页面已不调用它。 |
| 7 静态资源 | 构建最终文件生成 br/gz；服务缓存资源、协商编码，提供 ETag、Vary、HEAD/304，哈希资源 immutable；较大网页 JSON 使用 gzip。 |
| 8 coverage | 按完整索引状态与过滤条件缓存 60 秒，最多 128 项，构建期间不复用。命中样本约数毫秒；有过滤的首次计数仍约 0.23–0.26 秒，未保证首次 <200 ms。 |
| 9 向量 | 仅对 lexical 的最多 120/300 份候选重排，每份最多前 64 个合规向量 chunk，embedding+vector 预算 2.5 秒。未启用全库 HNSW 召回，因此纯语义命中或长文后部向量证据可能遗漏，query_plan 明确暴露范围。 |
| 10 lexical 语义 | 相邻汉字单字合为邻接词组，先全部词项匹配、空结果才任一词项回退；词组位置在原块中核验。匹配策略写入 query_plan 和接入文档。“加息 AI” matched_documents=1,047，远少于历史 17,620，但未达 <1,000；SQL 热态 <1 秒。没有为凑数量额外裁掉匹配项。 |
| 11 query | 普通列表使用不可变目录代次和键集分页，SQL 限定当前页，计数缓存，会话不保存全量结果；固定原版本、排序键和实体成员，空日期最后、相同排序键按 document_id 升序。group_by 仍保留分组结果快照。 |
| 12 并发与预算 | 8018、8020、MCP 和网页搜索共用 4 个准入槽，超额立即 429；搜索分阶段预算与显式降级；CLI/桥客户端最多重试一次，透传 Retry-After。尚无证据时超时可返回空的 degraded 响应，调用方必须检查状态。 |
| 13 日志 | 进入共享研究服务的请求全部追加到按 UTC 日期划分的 JSONL，含阶段耗时、并发、排队与状态，不含正文/token；鉴权前拒绝不在此日志范围内。health 增加 DB ping、闸门与 5 分钟 p95；启动前备份旧 stdout/stderr。 |
| 14 后台索引 | 核对频率改为 15 分钟，触发时有交互请求或排队读取则跳过；独立索引连接池；token 按文件状态缓存。 |
| 15–17 前端 | 系统字体栈，主 CSS 从约 462 KB 到 47.58 KB；KaTeX JS/CSS 仅在有公式标记时加载；标签最多展示 6 个；index/types/tags 缓存 5 分钟并沿用保存后的失效刷新。首页已有 home/status 并行请求。 |
| 18 HTTP/2 | 可选反向代理未部署；当前服务直接提供 brotli/gzip 静态资源。 |

## 传输量

生产构建的初始 HTML、主 JS、React 和 CSS gzip 合计约 **254 KB**，低于 400 KB；不含路由懒加载、正文数据及公式资源。普通页面不再引入 Noto 字体；公式页面仍按需使用 KaTeX 字体，不承诺其字体数小于 6。

本机 HTTP 实际 gzip 响应体：首页 8,722 B、导航 5,847 B、资料库 50 条 22,269 B、轻量标签 1,949 B。加上约 555 B 状态响应，首页/资料库常规控件接口合计低于 300 KB。此结论不包括打开长篇全文、下载原件、遗留全量索引/标签接口，也不是对所有页面任意内容的体积保证。完整 `/api/tags` 仍有约 799 KB gzip，前端控件已切到有界接口。

最终标签缓存检查：重启后的首次轻量/全量标签请求分别 848/598 ms，后续为 10/122 ms；即使请求 lookup limit=200，服务也只返回 20 条。该补充结果保存在 `outputs/perf-20260921-facet-cache.json`。

## 验证与复现

- `npm run typecheck`、`npm run build` 通过；构建产物的所有 br/gz 解压后与最终文件逐字节一致，首屏没有 KaTeX preload。
- `node --test --test-concurrency=1 tests/*.test.mjs`：184 通过、4 个按环境条件跳过。默认并行运行曾遇到 Node v24.14.0 测试运行器 IPC 反序列化异常；失败文件单独运行和全量串行运行均通过，没有以跳过该文件掩盖问题。
- 启用 `RESEARCH_GRAPH_DB_TEST=1` 后，全文/键集分页、实体图谱生命周期、读取池隔离 3 项集成测试全部通过，临时 schema 已清理。
- 独立临时数据库 `verify-query-fixture.mjs` 的 8 项端到端检查通过：索引、筛选、hybrid、版本回读、旧游标及 MCP 共用快照；临时数据库已清理。
- 新增回归覆盖 manifest 缓存/写副本隔离、NUL 清洗、编码协商、并发拒绝/释放、日志隐私、客户端重试/取消、词组与跨块匹配、空值/同值排序、固定实体成员和旧版本、快照过期。
- 最终真实服务 health 的数据库检查通过，队列为 0；POST page-targets 返回已存在页面并排除不存在的目标。WSL 未重启、配置未改动。

固定基准命令如下；执行前记录 worker 状态，脚本不会自行暂停或启动 worker。

```powershell
node scripts/benchmark-performance.mjs --rounds 3 --database-metrics --label workers-running --output outputs/perf-20260921.json
```

本机忽略目录保存原始证据：`perf-20260921.json`（运行 worker）、`perf-20260921-paused-final.json`（暂停 worker）、`perf-20260921-post-restart.json`（进程重启）、`perf-20260921-http-checks.json`（传输和健康）、`perf-tests-20260921.txt`、`perf-integration-tests-20260921.txt`。这些文件不包含凭据；未自动加入 Git。

生产升级顺序和查询契约见 [Agent 接入说明](agent-access.md)。数据库原件与历史证据保留；如需回退应用代码，新目录快照表可保留，不需要删除研究数据。已有客户端需更新轻量包才能获得本次自动重试逻辑，服务端召回策略变化无需重新配置 token。
