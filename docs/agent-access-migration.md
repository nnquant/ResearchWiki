# Agent 接入与统一 main 迁移

自 2026-09-21 起，仓库以原 investment 功能统一到 main，不再分别维护量化和投资分支。完整流程见 [单分支维护](branch-maintenance.md)。

## 接口与模块

- scripts/query/ 提供条件查询、索引、全文与向量检索、版本证据、分页和关系读取。
- scripts/agent/ 提供 HTTP、MCP、CLI、鉴权及安装分发。
- config/query-fields.json 定义过滤与输出字段契约。
- config/query-profile.json 保留 investment profile，通过 metadataAdapter 和 graphAdapter 加载投资元数据与实体图谱模块。模块名称不表示另一个 Git 分支。
- 统一 schema 兼容 factor、strategy、experiment、dataset 及 tests、uses_dataset、derived_from 等既有量化类型与关系。

## 部署迁移

所有实例跟踪 origin/main，但继续使用各自 dataRoot、PostgreSQL、端口和 runtime/mcp-read-token。源码统一不合并数据库，不复制其他实例的 config.json、runtime 或安装分享文件。安装包从当前实例生成，生成物和分享码保留在已忽略的 outputs 目录。

原 investment 实例切换到 main；原 quant 实例首次升级还需备份数据、暂停写入并激活 investment-research schema，再重建 Wiki 和查询索引。具体命令见 [首次升级](branch-maintenance.md#原-quant-main-部署首次升级)。

## 验证

```powershell
npm run build
node --test --test-concurrency=1 tests/*.test.mjs
```

数据库验收脚本 scripts/verify-query-fixture.mjs 从 WIKI_QUERY_TEST_DATABASE_URL 读取预先创建的独立测试库，只接受 researchwiki_test_* 数据库名。它检查量化样本类型、标签、页码证据、旧版本、关系、范围内向量召回及 MCP 快照一致性。向量请求使用本机模拟服务，不调用真实模型；运行者负责删除测试库。
