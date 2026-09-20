# Agent 局部图查询

## 从别名到原文证据

先 research_describe 确认 operations 包含 graph。以下 JSON 是 MCP 参数，也可存为 UTF-8 JSON 文件交给对应 CLI 操作 `--request 文件.json`；CLI 入口使用 SKILL.md 中的路径。

1. research_resolve 解析对象：

```json
{"kind":"entity","q":"英伟达","entity_type":"company","limit":10}
```

读取实际 entity_id、status、aliases、来源和数量。下方 NVIDIA ID 是初始映射示例，其他对象不能照抄或猜 ID。observed 只是待核验名称；curated 表示已配置身份映射。多个候选结合类型、市场和上下文消歧，信息不足时请用户指定或保留多个独立候选并说明。不要把母子公司、公司与证券自动合并。

2. research_graph 找实体关联材料：

```json
{"operation":"neighbors","seed":{"kind":"entity","id":"entity:company:nvidia"},"direction":"incoming","relation_types":["has_entity"],"depth":1,"max_nodes":80,"max_edges":120,"limit":20}
```

results 每项是一条边；source/target 包含节点 kind、id，document 节点包含版本和 slug。按文档 ID 去重，保留 provenance 原始字段、名称和版本。方向为材料 → 实体 has_entity、材料 → 标签 has_tag；从实体/标签找材料用 incoming/both，从材料找实体/标签用 outgoing/both。

3. research_search 在该实体范围内查正文：

```json
{"query":"资本开支","mode":"lexical","filters":{"field":"entity_ids","op":"contains_all","value":["entity:company:nvidia"]},"limit":10}
```

search 的参数为 query；resolve 的参数为 q。这里检索该实体的全部索引材料，不局限于图预算返回的几条边。列材料和计数则使用 research_query 的同一 filters。

4. research_read 用实际文档 ID 读取 outline，再以实际 revision_id、block_id 读取 blocks：

```json
{"id":"doc:实际ID","revision_id":"实际版本","view":"outline"}
```

```json
{"id":"doc:实际ID","revision_id":"实际版本","view":"blocks","block_id":"实际块ID"}
```

引用前阅读原文，页码以 read 为准。共现线索和库内声明关系均不能替代证据。

## 共同材料、分布与明确关系

research_graph 共同材料查询，两个 ID 均需先 resolve：

```json
{"operation":"intersection","seeds":[{"kind":"entity","id":"entity:company:nvidia"},{"kind":"entity","id":"entity:company:tsmc"}],"limit":20}
```

intersection 支持 2–5 个不同 entity/tag 节点，表示同一材料涉及这些对象，不推断供应链、竞争或因果关系。标签使用 resolve(kind=tag) 返回的 tag_id，不使用网页画布 ID。

范围分布：

```json
{"operation":"overview","group_by":"entity","filters":{"field":"published_at","op":"gte","value":"2026-07-01"},"limit":20}
```

group_by 支持 entity/tag/category。各实体 document_count 可以重叠，不能相加当总材料数；document_family_count 只是去重提示，不是已核验的独立来源数。

若核查观点，取得真实文档 ID 后用 neighbors，seed.kind=document，relation_types 指定 supported_by、contradicted_by 等 describe 声明的关系；也可 research_related。边方向沿 frontmatter 声明，例如观点 → 支持材料 supported_by。incoming 查谁指向当前材料。curated 仅描述身份映射，不能证明正文支持某个结论。

## 预算、完整性和停点

- neighbors 默认 1 跳、100 节点、300 边，上限 2 跳、400 节点、1000 边。先一跳，再按问题挑选节点扩展；已找到足够原文证据时停止。
- next_cursor 表示冻结结果还有分页；续页只传 cursor、limit、max_response_tokens 等预算，不改条件。有效期 10 分钟，重启可能失效；失效后重新查询不是原快照。
- traversal_truncated 表示图扩展截断，翻完分页仍可能不是完整邻域。缩小范围或选择节点继续，并说明未覆盖部分。
- overview 最多保留 1000 组；intersection 超过 10000 份材料会要求缩小范围。列全量材料应 query 分页，不通过无限增大图预算替代。
- 检查 graph_snapshot_id、graph_index.complete/pending_documents；实体筛选的 query/search 检查 coverage.entity_index 和 degraded。索引未完成时，空结果不能说明不存在。
- filters 约束遍历中的材料，受限文档可能切断路径。未返回路径不证明现实中无关系；放宽条件需符合研究目标并说明范围变化。
- resolve 无结果或身份待核验时，可查原始标签和关键词补充召回。只读 Agent 不批准别名合并、不启动全库重处理，将候选与歧义交给维护者。
# 实体检索补充召回与业务关系

```json
{"query":"资本开支","entity_name":"腾讯","entity_type":"company","mode":"lexical","limit":10}
```

向 `research_search` 发送上面的请求。已确认实体内的结果在前，原始名称的补充线索在后；两路结果按所选分组去重。`needs_evidence` 的材料需通过 read 核验，不自动升级为同一家公司。搜索仍是有候选上限的相关性检索，完整清单用 query。

证券查询示例（ID 应来自 resolve）：

```json
{"operation":"neighbors","seed":{"kind":"entity","id":"entity:security:hk:00700"},"relation_types":["issued_by"],"direction":"outgoing","depth":1}
```

返回公司节点后，沿 has_entity 查材料或以 entity_ids 过滤正文搜索。检查来源和时间；不要由共同出现推断供应链。历史查询可传 relation_as_of，但有效期未知的关系会被排除。有材料范围 filters 时，业务关系两端都必须有范围内材料。
