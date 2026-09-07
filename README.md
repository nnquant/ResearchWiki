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

当前安装脚本面向 Windows、PowerShell 7、Node.js 24、Git、uv 和 Docker Desktop。默认使用 CPU，数据目录为 `D:\data\researchwiki-investment`。有 NVIDIA GPU 时可将 `mineruDevice` 改为 `cuda`，安装脚本会选用 CUDA 依赖与 GPU Compose 配置。

```powershell
git clone https://github.com/nnquant/ResearchWiki.git
cd ResearchWiki
git switch investment
Copy-Item config.example.json config.json
# 按需编辑 config.json
pwsh -File scripts/install.ps1
```

安装脚本下载固定版本的 GBrain、安装 Node / Python 依赖、构建前端、启动数据库与 embedding 服务并初始化 Wiki。首次运行需要下载模型。

访问 <http://127.0.0.1:8018>。后续启动和停止：

```powershell
pwsh -File scripts/start.ps1
pwsh -File scripts/stop.ps1
```

默认仅监听本机。数据库密码由 setup 脚本生成，保存在数据目录的 `runtime/compose.env`。本地 `config.json`、数据、密钥、依赖和构建产物不纳入版本管理。IMA 需自行安装对应适配器并配置路径与知识库。

安装、启动、停止脚本通过 `scripts/deployment.ps1` 读取 `config.json` 中的数据目录和端口。默认 Wiki / MCP / PostgreSQL / Ollama 端口分别为 8018 / 3131 / 5436 / 11435；多实例部署应同时区分 `dataRoot`、`deploymentName` 和这些端口。CPU 解析较慢，首次使用需要下载模型。

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
