# 实体治理与 Agent 图谱：六项优化

## 1. 按材料上下文消歧

`config/entity-context-rules.json` 独立维护 ADC、TPU 的不同释义。只接受材料内明确的全称与缩写括号定义；行业共现不构成身份确认。同一材料出现多个释义、正文超过 128 块或 262144 字符时不自动确认。证据记录 revision、block、page 与 normalized_definition（规范化匹配文本，不可直接作原文引文）。读取原文仍使用 read。

## 2. 新材料增量治理

导入和后台索引复用实体词典、市场限定证券代码，以及名称与发行人都一致的“公司（代码）”。原始字段不改写，推断不回灌为新全库别名。正文/元数据版本变化、词典相关键变化才重建材料投影；注册表变化时复查带括号公司名。未确认记录使用 entity_mentions 的部分索引查询，不调用 LLM 重处理所有标签。

## 3. Agent 补充召回

search 新增 entity_name/entity_type：唯一明确实体内按研究问题查询，同时用原始名称做 lexical 元数据/正文召回。原始名称补充检索不是身份确认。响应带 entity_retrieval、retrieval_route、identity_status，保留用户 filters，按 document/document_family/passage 去重。每路有既有候选预算；没有声称结果穷尽。HTTP、MCP、CLI 共用契约；CLI 支持 --entity-name。

## 4. 治理工作台

图谱右侧“实体治理”进入 `/entities`。每页最多 50 个元数据提及，按名称搜索，查看候选、5 个原文片段和最近 20 次操作。确认、拆分需每个目标的原文引用；服务验证引用属于相同材料版本。操作影响当前材料内同类型、同名的所有字段，不改变源文档，也不全库推广。

确认、拆分、拒绝、暂缓、撤销均追加审计记录。拒绝和暂缓移出待核验队列，当前拒绝的候选不再显示；材料新版本重新核验。版本及操作编号校验防止覆盖新判断。记录与投影失效标记同事务保存，索引失败时返回 index_pending 并由普通刷新任务重试。后台接口仅在 Wiki 提供，沿用 Origin/Host/CSRF 保护；只读 Agent 不开放写入。

## 5. 回归与性能基准

`node scripts/query/entity-benchmark.mjs --live --output=work/entity-benchmark.json` 输出人工指定的身份回归案例结果、误合并数、precision、identity_recall，以及四类真实调用的首请求时间、10 次后续调用 p50/p95。样例覆盖母子公司分离、证券柜台、市场代码、缩写歧义和材料上下文。数据库集成测试覆盖证据、拆分/撤销、版本变化、增量重建和范围过滤。

回归准确率不是全库准确率；尚无人工标注的全库相关材料集合，不能据此报告全库资料召回率。串行性能数据不代表并发吞吐量，首请求不保证冷缓存。

## 6. 有来源和时间的业务关系

`config/entity-relations.json` 保存官方目录快照来源与人工关系。先从现有已核验证券目录/交叉核验生成 issued_by，不把证券与公司合并。记录 observed_at、source、evidence、valid_from/valid_to；缺少日期不编造，未知有效期为空。

维护者可在 relations 中追加 subsidiary_of、product_of、supplies_to，必须提供明确实体、URL、核验日期和原文 quote，刷新图索引后生效。product_of 的产品概念当前使用 topic/subfield 节点。没有从共现自动生产母子/产品/供应链关系。

graph neighbors 支持上述关系类型，沿用两跳/400 节点/1000 边上限。来源不同的边分别保留。relation_as_of 同时要求明确有效期及核验日期不晚于查询日；未知有效期被排除，不能代替历史知识库。有材料 filters 时，关系两端都须有范围内材料。

停用上下文规则、撤销人工判断、移除关系配置后刷新投影即可恢复；原始标签与历史引用未修改。
