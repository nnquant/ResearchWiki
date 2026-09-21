# Agent 接入使用说明

ResearchWiki 提供共享的条件查询、正文检索和版本化阅读服务。网页全文搜索、Agent CLI 与 MCP 使用同一服务；资料库支持相同的标签交集、并集、排除语义。

接入层统一在 main 维护，采用 investment profile 和实体图谱适配器，字段契约由 `config/query-fields.json` 定义。既有 factor、strategy、experiment、hypothesis、dataset 等量化类型仍可按 `page_type` 过滤，并追溯 `tests`、`uses_dataset`、`derived_from` 关系。旧部署升级说明见 [迁移说明](agent-access-migration.md)。

## 远程机器接入（主要入口）

知识库和查询索引只部署在服务端。远程 Agent 通过网络调用，不需要挂载知识库文件、连接 PostgreSQL，或安装解析器及模型。

| 入口 | 远程地址/配置 | 客户端需要什么 |
| --- | --- | --- |
| HTTP API | `POST http://服务器:8020/api/research/<操作>` | HTTP 客户端、Bearer token |
| 原生网络 MCP | `http://服务器:8020/mcp` | 支持 Streamable HTTP 和自定义 Bearer header 的 MCP 客户端 |
| CLI | `RESEARCHWIKI_URL=http://服务器:8020` | Node.js 22+、轻量客户端文件、token |
| stdio MCP 桥 | 同样的 URL/token 环境变量 | 轻量客户端和 MCP SDK |
| Skill | `skills/research-wiki/SKILL.md` | 已配置上述任一连接；Skill 本身不是传输协议 |

`8020` 是独立的研究只读服务，与 Wiki `8018`、内部 GBrain `3131` 区分。它在同一个 Wiki 进程中启动、停止，共享查询索引和游标；提供六个研究操作、`/mcp`、带鉴权的 `/health` 和 `/assets/`，以及维护者显式发布的安装资源。不会注册 Wiki 状态、编辑、导入或管理接口。除下述分享链接外均校验 Bearer，CSRF token 不能代替身份认证。

### 分享链接安装

维护者运行 `npm run research:share -- http://服务器:8020`，生成含当前 token 的安装 Markdown 和自包含 Node.js 脚本，发布到 `/install/<随机分享码>/researchwiki-install.md` 和同目录的 `researchwiki-install.mjs`。将命令输出的文档链接和“按文档安装并验证连接”转发给 Agent 即可，无需提供仓库或附件。

这两个地址无需 Bearer，分享链接本身授予获取只读凭据的能力，接收方仍需有内网访问权限。服务只提供这两个明确的文件，不列目录、不开放 outputs/private 中的其他内容；响应禁用缓存和索引。未发布时下载入口不可用。再次发布复用分享码并更新安装内容；将 `outputs/private/install-share.json` 中的 enabled 改为 false 即停止下载，无需重启。若需撤销已经下载安装的客户端，应另行更换读 token，仅停用下载链接不会撤销已分发凭据。

服务端 `config.json` 可配置：

```json
{
  "agent": {
    "enabled": true,
    "host": "0.0.0.0",
    "port": 8020,
    "publicBaseUrl": "",
    "wikiBaseUrl": "",
    "maxConcurrent": 4
  }
}
```

未配置 agent 时默认启用，host 继承 Wiki host，port 为 Wiki port + 2。`publicBaseUrl` 留空时根据已验证的 Host 生成原件绝对地址；HTTPS 反向代理或 URL 前缀部署时填写 Agent 的完整对外地址，如 `https://kb.example.com/research`，代理剥离此前缀并转发到 8020。只信任此配置，不采信客户端传来的 X-Forwarded-Host。`wikiBaseUrl` 仅在网页阅读器也有可达地址时填写，否则远程响应的 `open_url=null`，Agent 通过 `research_read` 阅读。`raw_url` 始终指向 Agent 服务，下载时仍需带 Bearer；不要把 token 放入 URL。

将此端口放在 Tailscale 等受控内网中，或使用 HTTPS 反向代理传输凭据。对外代理只映射 8020 的研究服务即可。当前使用一个共享只读 token（服务端 `dataRoot/runtime/mcp-read-token`，沿用现有接入凭据），由管理员通过私密渠道提供给授权 Agent；所有持有人可读取整个知识库，尚未实现逐 Agent 的配额、撤销或按文档 ACL。替换 token 文件可立即使旧凭据失效；不要分发服务端 config.json、数据库凭据或整个 runtime 目录。

### 轻量客户端

服务端运行 `npm run research:package`，将生成的 `outputs/researchwiki-agent/` 目录交给其他机器。该包只含接入脚本、查询契约、Skill 和说明，不包含研究材料或凭据。CLI 无第三方运行依赖；stdio MCP 桥及验证脚本需要先在包内运行 `npm install` 安装 MCP SDK。

在远程机器的客户端目录中：

```powershell
$env:RESEARCHWIKI_URL = "http://服务器:8020"
$env:RESEARCHWIKI_TOKEN_FILE = "C:\secrets\researchwiki-read-token"
node scripts/agent/cli.mjs describe
node scripts/agent/cli.mjs search "资本开支" --tag "行业:半导体" --mode hybrid
```

也可使用环境变量 `RESEARCHWIKI_TOKEN` 注入凭据，或用 CLI 的 `--url`、`--token-file` 指定连接；token 文件优先于 token 环境变量。显式配置远程 URL 后缺少凭据会报 AUTH_REQUIRED，不会尝试读取本机知识库配置。

原生 MCP 使用上述 `/mcp` URL，设置 HTTP header `Authorization: Bearer <私密凭据>`。传输为无会话 Streamable HTTP，POST 返回 JSON，不提供旧版 HTTP+SSE `/sse`；不支持仅 OAuth 登录而不能提供静态 Bearer 的连接器。客户端配置字段因实现而异。

仅支持 stdio 的客户端可在**客户端机器**安装轻量包后，设置 command 为 `node`、args 为客户端包的 `scripts/agent/mcp.mjs` 绝对路径，并给该进程传入 `RESEARCHWIKI_URL`、`RESEARCHWIKI_TOKEN_FILE`。这条桥也全程调用远程 API，不访问本地知识库。

### 从实际 Agent 机器验收

```powershell
# 在配置好上述连接环境变量的轻量客户端目录执行
npm install
node scripts/agent/verify.mjs
```

脚本验证认证、标签过滤/排除、游标、正文搜索、版本读取、原件下载，以及真实 MCP SDK 握手和调用与 HTTP 的一致性；stdout 输出不含凭据的 JSON 报告。防火墙、Tailscale ACL、DNS 和反向代理必须允许实际客户端到服务端端口；服务端自访网卡 IP 通过不能代替这一步。

研究操作共享最多 4 个并发槽位（可通过 maxConcurrent 降低，上限与读取池对齐为 4），覆盖 8020 HTTP/MCP、8018 研究接口和网页搜索。超额立即返回 429 与 Retry-After，不进入数据库等待队列。仓库客户端对 429、503、504/TIMEOUT 最多退避重试一次，尊重 Retry-After；超过 30 秒的等待提示直接交还调用方，主动取消不重试。查询有超时和输出预算。当前是单实例服务，查询游标会话保存在内存；将来多副本部署需粘性路由或共享游标存储。

## 建立与维护索引

```powershell
npm run research:index
npm run build
pwsh -File scripts/restart-wiki.ps1
```

`research:index` 从 manifest、Wiki 和已经解析的正文构建 PostgreSQL `research_query` schema，不调用解析、LLM 或 embedding。它保留原件，保存版本化文本和页码块，按文件指纹增量更新。首次构建需处理全库，耗时与正文体量有关；查询端明确显示构建/缺失状态。

正常启动的 Wiki 服务每 15 分钟核对并增量更新；启动时不立即扫描全库，触发时若仍有交互请求或排队读取则跳过该轮。`WIKI_QUERY_AUTOINDEX=0` 可关闭后台核对。手工与后台构建共用数据库锁，索引使用独立连接池；文件在读取过程中更新时保留旧版本，下一轮重试。原件解析失败的记录仍可在目录中找到，但没有正文能力。coverage 描述最近一轮登记清单的覆盖，不代表磁盘任意目录已被自动收录。

升级到 2026-09-21 的键集分页版本时，先运行上述 `research:index` 建立目录代次，再重启服务。索引完成后发布不可变的目录、版本引用、排序键和实体成员快照；旧代次退休超过 20 分钟后可清理，覆盖游标的 10 分钟有效期。NUL 字符在写入 PostgreSQL 前递归清洗，原件不改动。

投影是可重建的读模型，但 `research_query.revisions/blocks` 同时保留本功能启用后采集到的引用版本，数据库备份应包含该 schema。无需删除旧 GBrain 数据。维持默认的单实例数据目录，多个 Wiki 服务不要同时操作同一个 jobs 状态文件。

## CLI

```powershell
node scripts/agent/cli.mjs describe
node scripts/agent/cli.mjs resolve "半导体" --kind tag
node scripts/agent/cli.mjs query --tag "行业:半导体" --limit 20
node scripts/agent/cli.mjs query --tag-any "领域:DRAM" --tag-any "领域:NAND" --exclude-tag "已归档"
node scripts/agent/cli.mjs search "资本开支" --tag "行业:半导体" --mode hybrid --explain
node scripts/agent/cli.mjs read "doc:文献ID" --view outline
node scripts/agent/cli.mjs read "doc:文献ID" --revision-id "版本ID" --view blocks --page 12
node scripts/agent/cli.mjs query --request query.json
```

标签值必须以实际词典为准。重复 `--tag` 表示交集，重复 `--tag-any` 表示并集，`--exclude-tag` 排除。CLI 的 help 输出完整工具 schema；`--request -` 读取 stdin JSON，复杂条件无需自行处理 shell 转义。stdout 是 JSON，退出码 0 表示成功、2 表示部分参数错误、1 表示服务或其他错误。

原有 `node scripts/wiki.mjs search` 已转到统一服务；它的只读模式同样需要 Wiki 服务在线。底层 GBrain 管理入口仍保留为 `wiki.mjs gbrain ...`。

## MCP 与 Skill

`node scripts/setup-mcp.mjs` 生成当前项目的 `config/mcp.json`，其中绝对路径指向 `scripts/mcp-stdio.mjs`。该稳定入口现在提供七个只读研究工具：

| 工具 | 使用场景 |
| --- | --- |
| research_describe | 字段、真实标签、索引覆盖、能力声明 |
| research_resolve | 标签名称、标题、别名、代码对应材料的候选解析 |
| research_query | 条件列表、准确计数、字段投影、分组 |
| research_search | 过滤范围内的相关文档/段落发现 |
| research_read | 指定版本的元数据、目录、页、正文块及原文查找 |
| research_related | 前置字段中明确记录的有向研究关系，最多两跳 |
| research_graph | 实体/标签/材料局部邻接图、范围概览、共同材料交集 |

旧客户端需重连 MCP 以刷新工具清单。内部 GBrain HTTP MCP 继续独立存在；远程 Agent 使用 8020 的专用 ResearchWiki Streamable HTTP MCP。本机 stdio 和远程 stdio 桥仍受支持，七个工具定义与网络入口一致。resolve 新增 kind=entity，query/search 新增 entity_ids 筛选；使用方式见 [实体与图谱](entity-graph-agent.md)。

仓库提供 [research-wiki Skill](../skills/research-wiki/SKILL.md)。在目标 Agent 的技能配置中安装/引用这个目录即可；本次不会改动用户全局客户端配置。

## 查询契约

HTTP：`POST /api/research/{describe|resolve|query|search|read|related|graph}`。远程在 8020 专用入口使用 Bearer token；本机旧入口 8018 仍兼容同一只读凭据，网页继续使用既有 CSRF 机制。两个端口均保留 Host/Origin 检查；远程服务额外支持配置的 HTTPS 对外域名。

```json
{
  "filters": { "all": [
    { "field": "tags", "op": "contains_all", "value": ["行业:半导体"] },
    { "field": "published_at", "op": "gte", "value": "2026-07-01" },
    { "field": "institutions", "op": "contains_any", "value": ["实际机构名称"] }
  ] },
  "sort": "published_at", "direction": "desc", "limit": 20
}
```

`all/any/not` 可嵌套，最多 5 层、100 个节点。数组字段支持 contains_all/contains_any/contains_none，标量支持 eq/in，日期支持 gte/lte，所有字段支持 exists。非法字段、操作符、日期直接报错。证券代码按字符串处理，保留前导零；不自动合并不同市场的同名代码。历史标签的人工/机器来源不完整时记为 unknown，不伪造来源。

返回的 `total` 是 query 指定快照内的材料数量；search 的候选和排名不是全库枚举。每次返回可能因输出预算少于 limit；继续传入 `cursor`，可另设 limit/max_response_tokens，不能改变查询条件。游标保存在服务内，10 分钟、服务重启或缓存容量淘汰后失效，返回 CURSOR_EXPIRED。输出预算按每 token 两字符粗估，计入响应元数据，不等同于任意模型的精确 tokenizer。

默认 query 返回紧凑字段，可通过 fields 选择。日期是有记录来源的日期，不从文件名猜填；该版本不支持历史时点知识回放。机构、公司标签、别名和代码尚未归一为完整实体主库，resolve 会给出候选，需要研究者消歧。

## 原文与检索边界

- lexical：Intl.Segmenter 中英分词，将相邻且无空白分隔的汉字单字拼成 `<->` 邻接词组。多词先要求全部词项命中；只有严格匹配为空时才回退到任一词项命中，回退仍保留词组邻接约束。`query_plan.lexical_strategy=all_terms_then_any_term_fallback`，实际路径由 `lexical_match` 的 `all_terms_with_adjacent_han_phrases` 或 `any_term_fallback_with_adjacent_han_phrases` 声明。这是 2026-09-21 起的召回契约变化。先用当前版本的文档级 GIN 索引召回，再核验词组并在候选文档内选片段，不调用模型，也不是 BM25。`matched_documents` 和 `candidate_truncated` 说明过滤后的匹配数量与候选截断；不保证与旧排序等价。
- hybrid：对 lexical 已选出的最多 120 份候选（deep 为 300 份）使用已有 bge-m3 向量精确重排，再做 RRF。每份候选最多取前 64 个合规 chunk，保持模型、维度、文本哈希和版本时间检查；`query_plan.vector_scan=lexical_candidate_rerank`、`vector_chunks_per_document=64` 声明范围。此版本不提供全库 HNSW 语义召回，关键词未召回的文档、长文超过该窗口的向量证据可能遗漏。embedding 与向量查询共享 2.5 秒可选预算，超时保留已取得的关键词证据并报告降级。网页 fast 模式使用 lexical。
- deep：当前扩大候选数量。尚未配置生成式查询扩展和交叉编码器重排，响应会明确告知，不能视为已实现这些模型能力。
- 搜索按照文档默认去重，可选择 document_family 或 passage；译文与原文共享家族。文档级语义/标题命中可能没有可对齐的证据块，这时需要先读取目录。
- read 返回索引中保存的明确版本；原文块包含起止 UTF-16 字符偏移、章节和解析器物理页码。块可能切开超长表格，使用 neighbors 或继续读取恢复上下文；不猜印刷页码。
- 当前网页阅读器仍显示当前 Wiki 页面，搜索页码链接用于导航；严谨的历史引文应使用 Agent read 返回的 revision/block。原始 PDF 链接保留原件哈希用于核验。
- 独立 Wiki 页同路径原子编辑以及同 inode 重命名维持 ID；跨路径复制再删除且没有显式文献身份，不能自动证明是同一页。

## 验证与后续评测

升级到文档级召回索引时，维护者先运行 `npm run research:lexical-index` 回填派生投影，再重启服务；如果回填期间仍有旧进程索引材料，重启后再次运行该命令补齐差异。该命令可重复执行，不修改原文或旧引用版本。新索引任务在同一个事务内更新文档、正文版本和召回投影，`coverage.lexical_pending` 显示尚未更新的材料数。

普通 query 使用键集分页：会话只保存目录代次、条件、字段和排序定义，游标携带最后的排序键及 document_id，每页仅读取所需固定版本元数据；total 按快照与条件缓存。标题或日期相同时按 document_id 升序，空日期始终排在最后；旧游标保留原版本及原实体成员，不长期持有数据库事务。group_by 查询仍使用分组结果快照。read 的 metadata/outline 不传输整篇正文。coverage 按索引状态与条件缓存 60 秒，构建中不复用。

研究读取使用独立 4 连接池，排队支持超时取消；`explain=true` 返回覆盖率、候选 SQL、证据补全及排队计时。搜索阶段分别设置 coverage 0.5 秒、lexical 8 秒、关键词证据补全 2 秒、可选语义阶段 2.5 秒预算，并受全局剩余预算约束；超时返回已有证据和 degraded，若尚无证据则可能返回空的降级结果，调用方必须检查 degraded。

进入共享研究服务的请求（含超额 429）追加写入 `dataRoot/logs/research-requests-YYYY-MM-DD.jsonl`，按 UTC 日期分文件，记录时间、操作、状态码、阶段耗时、排队时长与并发数，不记录查询正文或 token。鉴权或传输层在调用研究服务前拒绝的请求不在此日志范围内。带鉴权的 `/health` 提供数据库 ping、读取闸门状态和最近 5 分钟请求 p95。启动脚本会在创建 stdout/stderr 重定向文件前备份旧日志。

```powershell
node --test tests/query-contract.test.mjs
node scripts/verify-agent-access.mjs
node scripts/evaluate-retrieval.mjs questions.jsonl lexical
```

实库验收报告写入 `outputs/agent-access-verification.json`，检查多标签、SQL 条件、版本回读、未向量化材料、只读权限与 MCP/HTTP 一致性。它属于功能验收，不是自然语言检索相关性的标注评测。

相关性评测输入每行一个 JSON：`id, query, filters?, relevant_documents, relevant_blocks?`，文档和块 ID 必须来自实际人工标注。工具输出 Recall@20、MRR、nDCG@10、证据命中和延迟，可比较 lexical/hybrid/deep。真实的 60–100 题研究问题集、独立验收集、模型重排、跨公司预测口径比较、材料包与草稿写回仍属于后续阶段。
