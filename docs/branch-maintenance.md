# quant / investment 分支维护

## 长期分支

| 分支 | 职责 |
| --- | --- |
| `main` | 量化版 quant，同时作为公共功能开发的起点 |
| `investment` | 投资版，保留分类、实体图谱、研报及文章处理等业务扩展 |
| `codex/*` | 临时功能或集成分支，验证后合并；不是独立部署版本 |

公共修复从最新 `main` 创建功能分支，把同一批提交依次合并到 `main` 和 `investment`。保留共同提交历史；不要把 investment 整条分支合回 main，也不要重复 cherry-pick 公共提交。投资业务功能只进入 investment。未完成的其他任务使用独立 worktree。

## 公共代码与扩展

`config/shared-core-files.json` 列出必须保持一致的查询、分页、缓存、限流、日志和 Agent 传输核心。`scripts/verify-shared-core.mjs` 比较两个 Git 引用的文件对象：

```powershell
git fetch origin
node scripts/verify-shared-core.mjs origin/main origin/investment
```

`config/query-profile.json`、`config/query-fields.json` 和页面 schema 属于业务配置，允许不同。`metadataAdapter` 处理投资元数据；`graphAdapter` 接入实体索引与查询。quant 不加载投资模块，保留 factor、strategy、experiment、dataset 和原有类型关系查询；investment 通过 `scripts/investment/query-graph.mjs` 启用实体能力。Web 页面与部署脚本允许有业务差异，但必须分别通过构建和测试。

## 每次公共改动的流程

1. 从 main 创建 `codex/<功能>`，在隔离工作区开发。
2. 运行完整测试和生产构建；涉及查询时运行独立数据库验收。
3. 在另一隔离工作区从 investment 创建集成分支，合并同一功能分支。解决业务差异后，再次运行测试和构建。
4. 使用 `verify-shared-core.mjs <功能分支> <投资集成分支>` 确认公共核心一致。
5. 将已验证提交快进到 main 和 investment，推送两条分支。不要把原工作区其他任务的未提交改动混入。

```powershell
node --test --test-concurrency=1 tests/*.test.mjs
npm run build
```

GitHub Actions 对两条分支的 push 和 PR 执行上述检查。数据库验收使用 `scripts/verify-query-fixture.mjs` 和环境变量 `WIKI_QUERY_TEST_DATABASE_URL`，仅接受 `researchwiki_test_*` 独立测试库。读池与检索集成测试使用 `RESEARCH_GRAPH_DB_TEST=1`，且必须把 `WIKI_DATA_ROOT` 指向测试配置目录；创建测试库的调用者负责清理。

## 性能迁移与部署

2026-09-21 已将投资版的正文全文索引、冻结目录游标、按需字段投影、独立读连接池、请求预算、重试、元数据缓存、轻量页面查找、静态压缩缓存和字体子集迁入公共维护流程。两版都保留原 Noto 字体，只导入使用的字重、拉丁和简体中文子集。

源码合并不等于更新运行中的实例。每个实例必须保持独立的 dataRoot、数据库、端口、runtime 和 token；禁止复制另一实例的配置、数据或安装分享文件。升级时先安装依赖和构建，停止旧 Wiki 服务，运行 `npm run research:index` 完成索引迁移，再启动新服务。索引不调用解析器或 embedding，保留历史证据版本。后台索引核对间隔为 15 分钟，不能代替首次升级迁移。

数据库内存预算属于部署配置。quant 提供 `WIKI_PG_*` 环境变量并使用保守默认值；investment 保留已验证的机器参数。不要把一台机器的 3GB shared_buffers 或 WSL 全局内存上限直接套用到其他部署。本次不修改 WSL 配置，不重启现有生产工作进程。
