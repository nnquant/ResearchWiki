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

GBrain 继续使用 `ollama:bge-m3` / 1024 维模型标识，HTTP 请求通过 Bearer 认证发送到内网 `/v1/embeddings`。内网不提供对话接口，文章 LLM 配置独立。兼容补丁将正文分块上限设为 1300 UTF-16 字符，预留标题与摘要上下文空间；所有请求另检查 2000 Unicode 字符上限、强制 float，超过限制时报错，不截断正文。GBrain 每批最多 16 段，遇到 429 等待 3 秒重试。关闭本机模型保温请求。

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

## 投资研究工作流

1. 从工作台创建公司、行业或宏观研究，按模板记录核心判断、预期差、支持与反方证据、催化剂和证伪条件。
2. 导入公告、财报、研报、政策文件或网页；用 `derived_from` / `supported_by` / `contradicted_by` 关联证据，并在正文标注页码或章节。
3. 用 `about` 关联研究对象，`belongs_to` 连接行业或主题，`impacts` 记录事件传导，`compares_with` 连接比较对象。关联目标须为已存在页面。
4. 填写资料截至日与下次复核日期。研究阶段为待研究、持续跟踪、已复核、已归档；到期且未归档的页面进入待复核列表。完成复核后更新下一次日期或清空，保留正文中的判断演变记录。

类型及关系契约见 [investment-research.schema.json](config/investment-research.schema.json)，研究字段见 [research-fields.json](config/research-fields.json)。新建对话框可填写字段，后续通过编辑页顶部 YAML 更新；日期为 `YYYY-MM-DD`，证券代码为字符串数组。资料截至日不自动使用创建日期，空值表示尚未确认。日期按服务所在时区判断到期。

已有部署切换到本分支后，需要在选定的数据目录执行 `node scripts/init-brain.mjs` 激活 `investment-research` schema，再执行 `node scripts/wiki.mjs index` 和 `npm run build`，重启服务。初始化会更改该数据实例的活动 schema；Git 分支不隔离数据库和文献数据。需要与 main 并行运行时，应使用独立 checkout 并分别配置数据目录、数据库、端口及容器项目名。切回 main 的部署应重新运行该分支的初始化与索引命令。

`seed-wiki.mjs` 仅创建不存在的导航与规范页面，不覆盖已有研究内容；已有量化导航不会自动改写。研究阶段用于组织工作，不等同于投资论点已被验证，也不自动产生评级或交易建议。

## 依赖

GBrain 固定提交 `8c70f6255047a7647adb30b1d6333a48068d9fa5`，由安装脚本从 [garrytan/gbrain](https://github.com/garrytan/gbrain) 获取。另使用 MinerU、Defuddle、Ollama、pgvector 等依赖；第三方软件遵循各自许可证。仓库不包含文献原件、模型权重或个人研究数据。
