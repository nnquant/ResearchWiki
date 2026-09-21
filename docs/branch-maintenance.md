# 单分支维护

自 2026-09-21 起，仓库只维护 main，以原 investment 的完整功能为基准。原 main 和 investment 的全部提交历史均保留；不再按 quant / investment 分支区分版本，也不再进行跨分支同步或一致性检查。

## 开发与验证

日常开发、修复、性能优化和发布均进入 main。提交前检查差异，只纳入当前任务的改动。需要隔离验证时可使用 detached worktree，完成后把已验证提交合入 main，不保留长期业务分支。

```powershell
git switch main
git pull --ff-only origin main
npm ci
npm run build
node --test --test-concurrency=1 tests/*.test.mjs
git push origin main
```

GitHub Actions 对 main 的 push / PR 执行安装、生产构建和回归测试，也支持手动触发。构建先于测试，确保字体子集、静态压缩和缓存校验执行。

查询改动还需使用独立 researchwiki_test_* 数据库运行 scripts/verify-query-fixture.mjs。WIKI_QUERY_TEST_DATABASE_URL 指向该测试库；集成测试设置 RESEARCH_GRAPH_DB_TEST=1，并把 WIKI_DATA_ROOT 指向测试配置目录。创建测试库的调用者负责清理。

## 统一功能与部署

main 使用现有 investment 配置，保留实体图谱、投资分类、文章与研报处理、性能优化和原 Noto 字体。既有 factor、strategy、experiment、dataset 等量化页面仍可读取和编辑。scripts/investment/ 和 query profile 的名称表示代码模块及 schema，不再对应 Git 分支。

可以部署多个实例，但它们均拉取 main，分别保留自己的 config.json、dataRoot、数据库、端口、runtime 和 token。合并源码不合并数据，不自动重启服务，也不修改 WSL 配置。

### 原 investment 部署

工作区干净时，切换到唯一维护分支：

```powershell
git fetch origin --prune
git switch main
git pull --ff-only origin main
git branch --set-upstream-to=origin/main main
```

如本地没有 main，使用 git switch --track origin/main 创建。未提交改动先妥善保存，不能使用强制重置覆盖。

### 原 quant main 部署首次升级

这次 main 已切换为完整投资研究版本，仅 pull 不会迁移运行中的 schema。保留本实例配置，备份数据库和数据，安装依赖并构建；暂停写入任务、停止旧 Wiki / MCP 服务后执行：

```powershell
node scripts/init-brain.mjs
node scripts/wiki.mjs index
npm run research:index
pwsh -File scripts/start.ps1
```

init-brain.mjs 激活统一的 investment-research schema；原量化页面类型仍保留。完成后恢复本实例的写入任务。数据目录、模型接口、数据库连接和内存预算继续使用本实例配置，不能直接覆盖为其他机器的配置。

后续普通更新执行 pull、安装依赖、构建，并按变更说明完成必要索引迁移后重启。后台索引核对不能代替首次升级迁移。
