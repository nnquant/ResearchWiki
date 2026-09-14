# ResearchWiki · Investment

面向主观与基本面投资研究的本地知识 Wiki，以公司研究、行业研究和宏观研究为核心，连接文献、观点、事件、估值与调研纪要。支持 PDF / 网页全文入库、中英文混合检索和证据追溯。

`main` 分支侧重量化研究；`investment` 分支侧重通用投资研究。既有因子、策略和实验页面在本分支仍可读取与编辑。

## 功能

- Vite + React 阅读界面，深浅主题、类型配色、正文大纲与独立文献 / 研究信息栏。
- MinerU 解析 PDF，保留原文件、图片、正文和页码映射；Defuddle 提取网页正文。
- GBrain + PostgreSQL / pgvector + Ollama bge-m3 提供关键词与语义检索。
- 作者、摘要、方法、结论、证据和适用边界等结构化字段；长字段折叠阅读。
- 公司 / 行业 / 宏观研究工作台，事件跟踪、估值分析、调研纪要与投资主题专用模板。
- 资料截至日、证券代码、市场地区、研究期限、研究阶段和下次复核日期；首页展示到期研究，资料库支持阶段和待复核筛选，并可按代码、别名或地区查找。
- 研究对象、所属行业 / 主题、影响对象、对比对象，以及支持 / 反驳证据的可追溯关系。
- 可选目录监听、IMA 导入和 OpenAI 兼容接口字段整理；默认不启用目录监听。
- MCP 接口与只读 stdio 桥接，支持研究 Agent 查询。

## 安装（Windows）

当前安装脚本面向 Windows、PowerShell 7、Node.js 24、Git 和 Docker Desktop。默认通过 Tailscale 内网服务进行 MinerU PDF 解析与 bge-m3 embedding，原件、解析结果和数据库保存在本机 `D:\data\researchwiki-investment`。纯本地模式另需 uv；将 `sharedApi.enabled` 设为 `false` 后使用 CPU，有 NVIDIA GPU 时可将 `mineruDevice` 改为 `cuda`。

```powershell
git clone https://github.com/nnquant/ResearchWiki.git
cd ResearchWiki
git switch investment
Copy-Item config.example.json config.json
# 按需编辑 config.json
# 内网模式：将管理员提供的个人密钥存入数据目录 runtime/shared-api-key，或设置 QUANT_API_KEY
pwsh -File scripts/install.ps1
```

安装脚本下载固定版本的 GBrain、安装 Node 依赖、构建前端、启动数据库并初始化 Wiki。内网模式不安装本机 MinerU、不下载模型或启动 Ollama；纯本地模式才安装 Python 依赖并下载模型。

访问 <http://127.0.0.1:8018>。后续启动和停止：

```powershell
pwsh -File scripts/start.ps1
pwsh -File scripts/stop.ps1
```

默认仅监听本机。数据库密码由 setup 脚本生成，保存在数据目录的 `runtime/compose.env`。本地 `config.json`、数据、密钥、依赖和构建产物不纳入版本管理。IMA 需自行安装对应适配器并配置路径与知识库。

安装、启动、停止脚本通过 `scripts/deployment.ps1` 读取 `config.json` 中的数据目录和端口。默认 Wiki / MCP / PostgreSQL / 本机 Ollama 端口分别为 8018 / 3131 / 5436 / 11435；多实例部署应同时区分 `dataRoot`、`deploymentName` 和这些端口。

## 内网 GPU 服务

`sharedApi.baseUrl` 默认是 `http://jiangda-pc.tail916afd.ts.net:8019`，必须使用完整域名，设备需有 Tailscale 访问权限。密钥从 `QUANT_API_KEY` 或 `sharedApi.apiKeyFile` 指向的纯文本文件读取；相对路径以数据目录为基准。启动脚本也会读取 Windows 用户级 `QUANT_API_KEY`。密钥仅由后端使用，不能提交到 Git。

PDF 以原始二进制上传，远端排队解析后下载 ZIP，保留 Markdown、图片、文件页码与内容块。每份最多 100 MiB / 500 页。任务 ID 保存在该文献解析目录的 `remote-job.json`，断线后复用任务；提交结果不确定时停止自动重传，需请管理员查找任务并填写该文件的 `id`。远端失败的任务同样保留 ID，不会被目录监听反复上传。排障后如确需重做，先确认原任务已终止，再归档该任务记录。已解析的资料无需重新上传。

GBrain 继续使用 `ollama:bge-m3` / 1024 维模型标识，HTTP 请求通过 Bearer 认证发送到内网 `/v1/embeddings`。内网不提供对话接口，文章 LLM 配置独立。兼容补丁将正文分块上限设为 1300 UTF-16 字符，预留标题与摘要上下文空间；所有请求另检查 2000 Unicode 字符上限、强制 float，超过限制时报错，不截断正文。共享接口每批最多 8 段串行发送，429/502/503/504 和网络异常在子批次内最多尝试 3 次，等待 2、4 秒（优先采用 Retry-After）。文章整理在暂存目录缓存已成功的子批次，索引重试复用抽取结果。持续 502 时仅尝试一次 GBrain 原生整页标题上下文索引，保留原始分块文本并原子记录向量及上下文模式；仍失败则延期，连续 3 次索引失败暂停。关闭本机模型保温请求。

首次将已有库切换到内网模式，停止 Wiki 后备份数据库，应用兼容补丁并重新分块、索引，再启动：

```powershell
node scripts/patch-gbrain.mjs
node scripts/wiki.mjs gbrain reindex --markdown --no-embed --json
node scripts/wiki.mjs index
pwsh -File scripts/start.ps1
# 验证模型；可额外传入一份 PDF 验证完整解析流程
node scripts/verify-shared-api.mjs
```

切换后旧 Ollama 容器可用 `docker compose stop embeddings` 停用（需使用本实例的数据目录、环境文件和项目名）；无需删除模型或数据库。`sharedApi.enabled=false` 可恢复本机计算，再重启 Wiki/MCP。

## 开发与验证

Agent 接入已提供六个只读研究工具、统一 CLI、标签交集/并集/排除及范围内正文检索。远程机器使用独立 Agent 端口（默认 8020）的 Bearer HTTP API 或 `/mcp` Streamable HTTP；CLI/stdio 桥支持 `RESEARCHWIKI_URL`，`npm run research:package` 生成不含知识库数据和凭据的轻量客户端。首次运行 `npm run research:index` 建立不依赖 LLM/向量化的正文索引；完整用法见 [Agent 接入说明](docs/agent-access.md)，研究工作流 Skill 位于 [skills/researchwiki](skills/researchwiki/SKILL.md)。

```powershell
npm ci
npm run dev
npm run build
npm test
```

开发服务器将 API 代理到 8018。前端构建到 `web/dist/`，本地服务直接读取构建资源。

## 导入与研究

```powershell
node scripts/wiki.mjs add-file "文章.pdf"
node scripts/wiki.mjs add-url "https://example.com/article"
node scripts/wiki.mjs index
node scripts/wiki.mjs search "研究问题"
```

字段契约见 [article-metadata.schema.json](config/article-metadata.schema.json)，Agent 录入方式见 [agent-ingestion.md](config/agent-ingestion.md)。LLM 字段整理为可选功能，其私有配置放在数据目录 `runtime/article-llm.json`。未知字段应留空，文献入库不代表研究结论已验证。

### 按月份批量处理报告

```powershell
# 生成固定队列：9→8→7→6→5 月目录，月内按文件名报告日期倒序
node scripts/import-report-batch.mjs --source D:\data\reports\raw --output D:\data\reports\processed --year 2026 --from-month 9 --to-month 5 --plan
# 先处理一份并验收；再启动隐藏后台进程持续处理剩余队列
node scripts/import-report-batch.mjs --limit 1 --batch-size 1
pwsh -File scripts/start-report-batch.ps1
```

批次仅扫描对应年份月份目录，不包含历史归档。文件名没有有效日期时使用日期子目录，再退到月份目录与修改时间；排序依据明确记录在队列中，不据此填充已核实发布日期。默认保留 `raw` 原件，处理成功后按报告日期直接保存到 `processed/YYYY-MM-DD/`（不再保留月份或机构目录层级），每份报告单独一个目录，包含 `original.pdf`、`parsed`（Markdown、页码、图片、JSON）及 `report.json`（原路径、哈希、Wiki 链接和入库结果）。同内容文件复用已解析记录，仍分别导出到各自目录。

已有旧目录可在暂停批次后运行 `pwsh -File scripts/migrate-report-layout.ps1` 迁移，原件和解析文件整目录移动，并更新断点路径。`processed/_batch/plan.json` 是不会自动重建的固定队列，`status.json` 显示进度，`events.jsonl` 保存断点，`failures.jsonl` 保存失败原因。首份即时入库，此后每 5 份更新索引；远端仅串行提交一个 PDF。只有原件复制、解析结果导出和向量完整性校验均成功，才标记完成。服务不可用时等待，可用磁盘低于 10 GiB 时暂停。

只批量解析：运行 `pwsh -File scripts/start-report-batch.ps1 -ParseOnly -Concurrency 4 -RetryFailed`。`-Concurrency` 可设置 1–4 路解析并持久保存，默认 1。每组按日期从新到旧派发最多 4 篇，一组全部结束后再派发下一组；完成顺序可不同。暂停会停止派发并等待当前组结束。每篇解析后立即导出原件、Markdown、图片和 `report.json`（状态为 `parsed`），跳过文章 LLM、数据库索引和向量化。已解析文件直接复用；此前因向量失败的报告可以补导出。进度包含 `mode: parse_only`，并分别统计 `parsed_only` 和之前已完成的 `indexed`。启动脚本保存此模式，重启后仍只解析；以后明确需要向量化时使用 `-ParseOnly:$false`，会重访仅解析的完成项并复用正文。

暂停：创建 `processed/_batch/pause` 空文件，当前解析与已解析小批次完成后退出。继续：删除该暂停文件，再运行启动脚本；当前模式已完成项不会重复处理。失败项默认跳过，可通过启动脚本 `-RetryFailed` 再试，远程任务仍复用已保存的 ID。上传结果不确定或远端任务已失败的报告需先排障，不自动重复上传。电脑重启后也需手动运行启动脚本，未安装计划任务。

内资报告源目录为 `D:\data\reports\raw1`，输出统一归入 `D:\data\reports\processed\内资`，按 `日期/内资_报告名称--ID/` 保存；原件导出名为 `内资_original.pdf`，`report.json` 记录 `report_category: 内资` 和 `original_file`。该批次的固定计划保存分类与命名，断点和日志位于 `processed/内资/_batch`，与原有批次独立。继续运行：

```powershell
pwsh -File scripts/start-report-batch.ps1 -Source D:/data/reports/raw1 -Output D:/data/reports/processed/内资 -Year 2026 -FromMonth 9 -ToMonth 8 -ParseOnly -Concurrency 4
```

### 报告存储去重

同一磁盘上的批次导出使用硬链接共享 PDF、图片和 MinerU 的 middle/model/content_list JSON，保留原目录结构。Markdown、页码映射、报告信息和运行状态仍独立保存；跨磁盘导出使用副本。共享文件应当作不可变证据，编辑时应另存文件；硬链接不是备份，目录属性中的大小相加也不代表实际占用。

本机已有报告可运行 `node scripts/deduplicate-reports.mjs --plan` 生成清单，再运行 `node scripts/deduplicate-reports.mjs --apply` 执行。工具仅处理固定批次中同时具有成功事件、完成报告和有效 Wiki 记录的文件，逐文件校验 SHA-256 后原子替换重复副本。原始下载路径不替换、不删除、不移动；未完成、失败、内容不同和非共享类型的文件保留。审计清单、操作日志和原件路径完整性结果保存到 `outputs/report-dedup-20260913/`。该脚本为本机固定目录的一次迁移工具，重复执行会跳过已共享文件。

## 投资研究工作流

1. 从工作台创建公司、行业或宏观研究，按模板记录核心判断、预期差、支持与反方证据、催化剂和证伪条件。
2. 导入公告、财报、研报、政策文件或网页；用 `derived_from` / `supported_by` / `contradicted_by` 关联证据，并在正文标注页码或章节。
3. 用 `about` 关联研究对象，`belongs_to` 连接行业或主题，`impacts` 记录事件传导，`compares_with` 连接比较对象。关联目标须为已存在页面。
4. 填写资料截至日与下次复核日期。研究阶段为待研究、持续跟踪、已复核、已归档；到期且未归档的页面进入待复核列表。完成复核后更新下一次日期或清空，保留正文中的判断演变记录。

类型及关系契约见 [investment-research.schema.json](config/investment-research.schema.json)，研究字段见 [research-fields.json](config/research-fields.json)。新建对话框可填写字段，后续通过编辑页顶部 YAML 更新；日期为 `YYYY-MM-DD`，证券代码为字符串数组。资料截至日不自动使用创建日期，空值表示尚未确认。日期按服务所在时区判断到期。

已有部署切换到本分支后，需要在选定的数据目录执行 `node scripts/init-brain.mjs` 激活 `investment-research` schema，再执行 `node scripts/wiki.mjs index` 和 `npm run build`，重启服务。初始化会更改该数据实例的活动 schema；Git 分支不隔离数据库和文献数据。需要与 main 并行运行时，应使用独立 checkout 并分别配置数据目录、数据库、端口及容器项目名。切回 main 的部署应重新运行该分支的初始化与索引命令。

`seed-wiki.mjs` 仅创建不存在的导航与规范页面，不覆盖已有研究内容；已有量化导航不会自动改写。研究阶段用于组织工作，不等同于投资论点已被验证，也不自动产生评级或交易建议。

## 已保存的译文

### 先处理一篇中文样稿

将 OpenAI 兼容模型的 `baseUrl`、`apiKey`、`model` 保存到本机 `work/article-llm.json`（已被 Git 忽略）。这个配置仅用于手动整理，不会启用正在运行的批量 PDF 解析任务的 LLM。

```powershell
# 按正文发布日期优先、来源排序日期兜底，从新到旧；默认只处理一篇
node scripts/enrich-articles.mjs --limit 1
# 抽取和翻译完成后，将指定结果写回 Wiki，并仅向量化这一篇及其中文译文
node scripts/enrich-articles.mjs --publish work/article-enrichment/<文献ID>
# 持续按从新到旧抽取摘要、标签、关键信息并逐篇入库及索引（不翻译）
pwsh -File scripts/start-article-enrichment.ps1
# 最多 8 篇同时抽取；原文入库与向量化仍逐篇执行
pwsh -File scripts/start-article-enrichment.ps1 -Concurrency 8
```

处理结果保存在 `work/article-enrichment/`，包含队列、中文摘要、标签、关键信息、匹配原文的证据和模型响应缓存。摘要抽取和翻译均整篇一次提交，不分段、不截断；全文译文另检查文件页号、图片引用及表格数字。原文摘要与模型中文摘要分开保存；原文、已解析文本与页码不变。翻译覆盖已解析文本并保留原图，不保证翻译图片内未解析的文字。已完成结果再次执行时跳过；未完成结果复用模型响应缓存。只在原文及译文向量完整性校验通过后标记完成。运行发布步骤时需要其他导入任务释放导入锁。

不翻译的后台批次使用 `work/article-metadata-batch/` 保存模型缓存，数据目录 `state/article-enrichment/status.json` 显示当前进度，`documents.json` 与 `failures.jsonl` 保存断点和失败原因。已完成抽取并索引的文献全部跳过，新增字段仅应用于后续未完成报告，不自动补抽历史文献；每组结束后刷新已解析文章队列。启动参数 `-Concurrency 1–8` 控制一组并行抽取篇数，省略时读取私有 LLM 配置的 `concurrency`，再默认 1。抽取可以并行，入库和向量化仍按队列顺序逐篇执行；`active_articles` 列出当前各篇阶段。临时模型连接故障进入 `waiting_service`，以 30 秒起、最长 5 分钟的间隔检查模型列表，服务恢复后自动续跑；等待断点保存在 `service-recovery.json`，再次启动工作进程时读取。401/402/403 停止后续派发，等待已发出的组内请求结束，保留其暂存结果。创建 `state/article-enrichment/pause` 空文件可在当前组结束后暂停；服务等待期间也响应暂停。未设置开机启动。

官方 DeepSeek 可在私有 LLM 配置中设 `offPeakOnly: true`，模型 `deepseek-flash`、`thinking: "disabled"`。每组派发及每次模型请求（包括校验重试、字段分组）都检查北京时间：工作日避开 09:00–12:00 和 14:00–18:00，周末全天为闲时。开始忙时前按单次请求超时加 30 秒提前停止新请求，默认 10 分 30 秒；闲时自动恢复已有断点。[官方时段规则](https://api-docs.deepseek.com/quick_start/pricing/)（2026-09-12 核对）。

也支持官方 CodeBuddy CLI：配置 `transport: "codebuddy-cli"`、`model`、用于断点标识的 `baseUrl: "codebuddy://cn"`、指向已安装 npm 包 `bin/codebuddy` 的绝对 `cliPath`，以及独立的 `cliWorkingDirectory`，使用已登录账号，无需 DeepSeek API Key。通过启动脚本的 `-LlmConfig` 和 `-Output` 指定配置及独立暂存目录。正文完整通过标准输入发送，每篇独立会话；工具、MCP、Hooks 和会话保存关闭，不指定备用模型，并核对实际返回模型。`skipPreviouslyFailed: true` 可在换模型时继续跳过历史失败报告。积分不足、认证或 CLI 配置异常停止；临时连接故障按原有退避间隔重试待处理文章，不额外发送收费的健康测试。原始响应缓存及 `*.usage.jsonl` 保存实际积分，成功文档的 `usage_summary` 包含已记录的校验重试用量；未返回积分时用 null，不按零计费。折扣以账号活动与实际扣费为准。

CodeBuddy 使用流式输出，在 `max_tokens/length` 结束信号、截断提示或可见输出预算超限时结束该次 CLI 进程，转为按字段分组抽取。正常报告仍只调用一次；分组分别处理摘要结论、研究对象、评级目标价及盈利预测，超长分组再细分，叶子分组仍超长则记录该篇失败并继续队列。所有调用均读取未截断的全文，已完成分组写入独立缓存，断线或暂停后仅续跑未完成部分；全部分组通过原文证据校验后由程序合并，再入库。真实模型变化及缺失模型身份仍停止，截断提示单独分类。`*.cli-*.json` 保存不含正文或凭据的事件诊断；配置 `cliLogDirectory` 时可从官方 CLI 日志中按本次 PID 和开始时间读取实际积分，取消请求后尚未报告用量则保持 null。

在文献页面的 YAML frontmatter 中填写 `translation_path: parsed/文献目录/translation.zh.md`，或在 `state/manifest.json` 对应文献记录中设置 `translation_path`（页面字段优先）。路径相对于数据目录，须位于 `raw/`、`parsed/` 或 `wiki/` 下。

页面工具栏仅在译文文件存在且非空时显示“翻译”按钮；未关联、文件缺失或路径不可访问时隐藏。点击打开已保存的文件，`wiki/` 下的 Markdown 译文进入 Wiki 阅读页，其他格式沿用附件打开或下载行为。此功能不调用即时翻译服务。

## 依赖

GBrain 固定提交 `8c70f6255047a7647adb30b1d6333a48068d9fa5`，由安装脚本从 [garrytan/gbrain](https://github.com/garrytan/gbrain) 获取。另使用 MinerU、Defuddle、Ollama、pgvector 等依赖；第三方软件遵循各自许可证。仓库不包含文献原件、模型权重或个人研究数据。
