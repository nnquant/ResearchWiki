# 实体别名与 Agent 局部图查询

## 已实现

- 不调用 LLM。格式规范化仅做 NFKC、首尾空格、连续空格和大小写；不会删除名称内部标点、证券代码前导零，也不推测母子公司或技术概念是同一实体。
- `config/entity-registry.json` 是本实例可审阅、可回滚的实体映射来源，不随源码分发。新安装没有已确认实体；原始名称仍可作为 observed 名称参与检索。来源链接由维护者保存在条目中。批量处理方法见 [实体治理操作说明](entity-reconciliation.md)。
- 没有确认映射的名称得到稳定 `entity:observed:*` ID，标记 observed（原始名称，身份待核验）；同一别名对应多个配置实体时保留 ambiguous 候选，不挂接任意实体。
- 公司、证券、行业、领域、主题分类型。证券实体要求字符串 code、market，可通过 issuer_id 指向公司，不与公司共用 ID。裸代码、集团和子公司不自动合并。
- 原文和原始 tags/companies 等字段保持原样。额外索引记录原始字段和值、匹配状态、文档版本。
- `query/search` 的统一过滤语法新增虚拟字段 `entity_ids`，支持 contains_all / contains_any / contains_none / exists。query 可通过 fields 或 group_by 返回实体 ID。
- 图谱、资料库、检索增加“实体与别名”选择器，选定实体后使用相同的数据库映射；图谱跳转资料库/正文检索时保留 entity_id。
- 网页画布仍是有节点上限的展示；原始标签名称保持可见，不因实体合并而删除。网页展示 Wiki 材料，Agent 查询登记材料；实体映射相同，但登记尚未生成 Wiki 页的材料不出现在画布上。

## 建立及增量更新

```powershell
npm run research:index
# 已有正文索引时，仅建立或刷新图谱，不重读原文、不产生新正文版本：
npm run research:graph-index
```

首次回填现有材料的元数据（投影 v2 首次升级也会回填）。之后按 document_id + revision_id 处理变化项；别名配置变更比较每个“类型＋规范化名称”的候选 ID 集合，通过名称索引仅重新投影受影响材料。未被材料使用的别名变更无需重投影。删除和恢复同步处理。普通查询索引刷新结束后自动刷新图谱，现有定时刷新间隔约 5 分钟；也可执行上述命令立即更新。

图谱投影在数据库事务内发布，失败回滚。查询只使用与活动文档版本一致的成员关系，旧版本关系不会用于新版本；graph_index.pending_documents 和 complete 暴露待同步情况。映射更新不会改动历史引文。

## 治理和纠错入口（本机 CLI）

```powershell
npm run research:entities -- pending
npm run research:entities -- validate config/entity-registry.json
npm run research:entities -- apply work/reviewed-entities.json
npm run research:graph-index
```

`pending` 按材料频次列出前 200 个 observed/ambiguous 名称，优先治理高频项。`apply` 接收完整映射表，先校验再备份旧配置并原子替换；备份路径会打印。撤销误合并：修正或移除对应 aliases 后重新 apply 和刷新图谱。不要把模糊匹配或 LLM 猜测直接加入确认映射。

条目示例（替换为核对过的真实身份和来源）：

```json
{"version":1,"entities":[{"entity_id":"entity:company:example","type":"company","name":"标准名称","aliases":["已核对的别名"],"source":"核验资料 URL 或内部记录"}]}
```

变更已有实体时保持 entity_id 稳定；不要复用 ID 表示另一家公司。`entity:observed:` 命名空间由系统保留。别名歧义会在 validate 输出和 Agent resolve 中明确显示。管理入口不暴露到远程只读 Agent 服务。

## Agent 调用

HTTP：`POST /api/research/graph`。MCP：`research_graph`。CLI：`npm run research -- graph --request work/graph-request.json`。沿用既有 Bearer、Host/Origin、超时与返回预算控制，无新增写权限。

先解析对象：

```json
{"kind":"entity","q":"英伟达","entity_type":"company"}
```

通过 `research_resolve` 获取 entity_id。同名多个候选时补充信息，不默认选择第一项。实体范围查询或正文检索：

```json
{"filters":{"field":"entity_ids","op":"contains_all","value":["entity:company:nvidia"]},"fields":["entity_ids","tags"],"limit":20}
```

局部邻接图：

```json
{"operation":"neighbors","seed":{"kind":"entity","id":"entity:company:nvidia"},"direction":"both","relation_types":["has_entity"],"depth":1,"max_nodes":100,"max_edges":300,"limit":20}
```

方向契约：材料 → 标签为 has_tag，材料 → 实体为 has_entity；从实体查材料用 incoming 或 both。明确关系沿 frontmatter 声明方向，例如观点 → 支持材料 supported_by。实体/标签共现不会升级成因果、产业链或支持关系。

每个 results 项是一条边，携带 source/target 节点及 provenance。document 节点带文档版本和 slug，provenance 带原始字段/标签或实体匹配依据。curated 仅描述身份映射，不能证明正文支持某项结论；需继续 research_read。

范围概览：

```json
{"operation":"overview","group_by":"entity","limit":20}
```

group_by 支持 entity/tag/category。返回 document_count，以及作为去重提示的 document_family_count；后者不是已核验的独立来源数。分类含无标签材料，标签/实体覆盖允许重叠。

共同材料：

```json
{"operation":"intersection","seeds":[{"kind":"entity","id":"entity:company:nvidia"},{"kind":"entity","id":"entity:company:tsmc"}],"limit":20}
```

2–5 个不同的 entity/tag 节点，返回同时覆盖全部对象的材料及版本。标签 ID 通过 research_resolve(kind=tag) 取得。文档节点 ID 通过 query/search/read 取得，不使用画布的临时标签节点 ID。

## 预算、分页和完整性

- neighbors 默认 1 跳、100 节点、300 边，上限 2 跳、400 节点、1000 边。数据库按邻接索引查询，不再将全部关系读入 JS 后遍历。
- `truncated / next_cursor` 表示当前响应分页；cursor 冻结本次结果 10 分钟。续页只传 cursor、limit、max_response_tokens 等预算，不能改变条件。
- `traversal_truncated` 是另一回事：表示节点/边预算限制、或概览只保留前 1000 组。翻完分页仍不代表完整全库；应缩小范围或以返回的节点继续查询。
- intersection 最多物化 10000 份材料，超出会明确要求缩小范围，不静默丢掉剩余材料。
- graph_snapshot_id 标识图谱索引水位，graph_index.pending_documents 表示活动版本尚未投影的材料。总览统计基于当前索引，不能当作历史时点数据。
- 旧 research_related 保留返回格式，底层改为关系索引，默认只遍历明确 frontmatter 关系。
- 网页支持按实体筛选图谱、资料库和正文检索，并在跳转时保留实体范围。实体资料库只读取匹配材料的 YAML 元数据；筛选器按需检索标签，侧栏使用轻量导航，避免为局部浏览加载全库正文。列表摘要取元数据摘要，反链数量显示为空；完整内容仍在阅读页查看。
- 使用 entity_ids 筛选的 query/search 返回 entity_index 水位；待投影材料存在时标记 coverage.complete=false，避免把暂未完成的实体索引当作全量结果。

## 验证

```powershell
node --test --test-isolation=none tests/entity-graph.test.mjs
$env:RESEARCH_GRAPH_DB_TEST='1'
node --test --test-isolation=none tests/entity-graph.integration.test.mjs
node scripts/agent/verify-graph.mjs
```

数据库测试创建独立临时 schema，覆盖别名、冲突、筛选、交集、方向、来源、变更、删除和恢复，结束后只清理该临时 schema。verify-graph 对运行中服务进行只读 HTTP 验收，包括冻结分页和条件不匹配拒绝。
