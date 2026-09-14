# 公共 Agent 接入层的分支维护

`codex/agent-access` 从量化 `main` 创建。公共功能提交先合并到 `main`，再把同一分支合并到 `investment`，两边保留共同祖先。不要将整条 investment 分支并回 main，也不要重复 cherry-pick 同一公共提交。

## 公共接口与业务配置

- `scripts/query/`：条件查询、索引、全文/向量检索、版本证据、分页与关系读取。
- `scripts/agent/`：HTTP、MCP、CLI、鉴权及安装分发。
- `config/query-fields.json`：过滤与输出字段契约，服务端、CLI、MCP 和轻量安装包共用。
- `config/query-profile.json`：部署的研究名称、可选 metadataAdapter 及网页类型过滤字段。main 为 quant，investment 为 investment。
- main 直接保留原始标签和量化页面类型；investment 通过 `scripts/investment/query-metadata.mjs` 调用投资版分类与实体标签逻辑。公共核心不导入文章整理或解析代码。
- 关系类型复用当前部署的 `server/slugs.mjs` schema，因此 main 的 factor、strategy、experiment、dataset 及 tests、uses_dataset、derived_from 等语义不变。
- embedding 保留本机 Ollama 和可选的共享 HTTP 配置，不引入投资版 PDF/文章批处理依赖。

## 部署边界

Git 迁移只涉及源码。两个部署必须使用各自 dataRoot、PostgreSQL 数据库、端口和 runtime/mcp-read-token，不能复制另一实例的 config.json、runtime 或安装分享文件。安装包每次从当前实例生成；生成物及分享码放在已忽略的 outputs 目录。

升级进程后运行 `npm run research:index` 或等待自动核对。索引指纹现在包含 profile 和字段契约，首次核对会重新构建读模型；不会调用解析器或 embedding，也不会删除保留的历史引用版本。新量化实例还需按接入说明初始化自己的 token。

## 验证

```powershell
node --test --test-isolation=none tests/query-contract.test.mjs tests/query-profile.test.mjs tests/agent-network.test.mjs tests/agent-skill-install.test.mjs
npm run typecheck
npm run build
```

数据库验收脚本为 `scripts/verify-query-fixture.mjs`，从 `WIKI_QUERY_TEST_DATABASE_URL` 读取管理员预先创建的独立测试库，只接受 `researchwiki_test_*` 数据库名。它在工作区生成量化样本，检查索引、标签排除、类型过滤、页码证据、旧版本、关系、条件内向量召回以及 MCP 快照一致性。向量请求使用本机模拟服务，不调用真实模型。运行者负责最后删除自己创建的测试库。

后续公共修复仍从 main 创建独立功能分支，验证后分别合并到两条业务分支。只改变投资业务语义的代码留在 investment 适配器、模板和文章整理模块。
