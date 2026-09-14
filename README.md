# ResearchWiki

面向量化研究的本地文献与知识 Wiki。支持 PDF / 网页全文入库、中英文混合检索、研究笔记及证据关系。

## 功能

- Vite + React 阅读界面，深浅主题、类型配色、正文大纲与独立文献 / 研究信息栏。
- MinerU 解析 PDF，保留原文件、图片、正文和页码映射；Defuddle 提取网页正文。
- GBrain + PostgreSQL / pgvector + Ollama bge-m3 提供关键词与语义检索。
- 作者、摘要、方法、结论、证据和适用边界等结构化字段；长字段折叠阅读。
- 观点、假设、因子、策略、实验与文献之间的可追溯关系。
- 可选目录监听、IMA 导入和 OpenAI 兼容接口字段整理；默认不启用目录监听。
- MCP 接口与只读 stdio 桥接，支持研究 Agent 查询。

## 安装（Windows）

当前安装脚本面向 Windows、PowerShell 7、Node.js 24、Git、uv、Docker Desktop 与 NVIDIA CUDA 环境。默认数据目录为 `D:\data\gbrain`；安装、启动脚本及 Compose 使用该目录，迁移位置时须同步调整。

```powershell
git clone https://github.com/nnquant/ResearchWiki.git
cd ResearchWiki
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

## 依赖

GBrain 固定提交 `8c70f6255047a7647adb30b1d6333a48068d9fa5`，由安装脚本从 [garrytan/gbrain](https://github.com/garrytan/gbrain) 获取。另使用 MinerU、Defuddle、Ollama、pgvector 等依赖；第三方软件遵循各自许可证。仓库不包含文献原件、模型权重或个人研究数据。

## Agent 查询与远程接入

HTTP、MCP 和 CLI 共享条件查询、全文检索、版本阅读与标签组合。使用 `npm run research:index` 建立读索引、`node scripts/setup-mcp.mjs` 初始化本实例只读凭据。详见 [接入说明](docs/agent-access.md)。公共代码通过 `config/query-profile.json` 选择业务适配，字段契约位于 `config/query-fields.json`；main 默认量化研究。
