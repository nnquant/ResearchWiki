---
name: research-wiki
description: 查询 ResearchWiki 投研知识库，解析实体与别名，沿局部图关系寻找材料或多个实体的共同材料，按标签、机构和日期检索正文，读取带版本和页码的原文证据。
---

# ResearchWiki 研究材料接入

优先使用已连接的 `research_*` MCP 工具。远程入口是服务端 `http(s)://<服务器>/mcp`（Streamable HTTP、Bearer 鉴权）；也可在轻量客户端目录运行 `node scripts/agent/cli.mjs`，通过 `RESEARCHWIKI_URL` 和 `RESEARCHWIKI_TOKEN_FILE`（或 `RESEARCHWIKI_TOKEN`）连接。CLI help 返回完整工具 schema，stdout 是 JSON。Skill 本身不建立连接；连接设置见 [接入说明](../../docs/agent-access.md)。远程 Agent 无需知识库文件、数据库或模型环境。

- 量化研究可用 page_type 筛选 factor、strategy、experiment、hypothesis、dataset；用 related 追溯 uses_dataset、tests、derived_from 等真实关系。
- 初次访问用 `research_describe` 查看真实能力和索引覆盖。
- 若 capabilities 包含 graph，先用 `research_resolve(kind=entity,q=...)` 解析实体与别名；用 entity_ids 字段过滤 query/search。observed 是待核验原始名称，curated 仅表示已配置身份映射；多个候选不可默认选第一项。
- 沿关系找资料或找共同材料时，读取 [局部图查询流程与示例](references/local-graph.md)。`research_graph` 提供 overview、neighbors、intersection；默认一跳，最多两跳。先读取局部关系，再用 read 核实原文，不将共同标签/实体升级为支持、影响或因果。
- 图谱的 next_cursor 是本次结果分页；traversal_truncated 是图扩展预算截断，两者不同。翻完分页仍可能只是局部图，需缩小范围或选择节点继续查询。检查 graph_index.complete/pending_documents。
- 401 表示凭据缺失或失效，429 按 Retry-After 退避；不要通过读取服务器私有配置或直连数据库绕过接入接口。不要在日志、URL 或回复中输出 token。
- 原件 `raw_url` 是网络下载地址，下载请求仍需 Bearer；仅向管理员配置的知识库服务源发送凭据。`open_url=null` 表示未配置可达的网页阅读器，继续使用 `research_read`。provenance 中的路径是服务端来源记录，不是客户端磁盘路径。
- 用户提及公司、证券或别名时优先 resolve(kind=entity)；提及标签时用 resolve(kind=tag) 或 describe(section=tags,q=...) 查实际标签。实体覆盖不足时可用原始标签、关键词补充召回，并说明身份待核验；多个候选不要擅自合并。
- 按实体找正文时可直接使用 `research_search(query=研究问题, entity_name=原始名称, entity_type=类型)`：服务会合并已确认实体范围与原始名称的元数据/全文召回。检查 `entity_retrieval`、`retrieval_route`、`identity_status`；`needs_evidence` 不是实体身份确认。用户传入的 filters 始终保留（包括 entity_ids），若该范围限制补充召回，先说明再调整。`requires_context=true` 的缩写候选必须在具体材料中核验定义，不能当作全库别名。
- 需要“全部报告”、计数或分组时用 `research_query`；按问题找相关材料时用 `research_search`。标签条件同样适用于两者。
- 标签支持 `contains_all`（交集）、`contains_any`（并集）、`contains_none`（排除）。组合条件用 `filters.all/any/not`。缺少标签不代表正文不涉及；扩展搜索范围时明确说明。
- 搜索卡是发现线索。引用前使用 `research_read`，带上 document_id、revision_id 和 block_id。首次阅读长文用 outline，然后选 blocks；表格、公式、脚注保留在原文中。
- PDF 页码是解析器标记的物理页；网页可以只有正文块定位。无证据定位的文档命中需要进一步阅读，不能猜页码。
- 查询响应中的 next_cursor 表示尚有结果。翻页只传 cursor 及 limit/预算，不改变条件；10 分钟或服务重启后游标可能失效。
- `research_related` 读取明确写入的关系。支持/反驳关系是库内记录，仍需阅读来源；正文提及不等于支持结论。
- 检查 coverage、degraded、empty_reason 和 query_plan。未完成索引或向量失败时不能把零结果说成“库里没有”。lexical 模式无需模型；deep 当前只扩大候选，不具备生成式扩展或交叉编码器重排。
- 日期范围是记录的发布日期，不是历史时点知识回放。原文、译文、阅读卡不是独立的多份证据。

## 局部图的调用决策

- 找关联材料：neighbors 从实体、标签或文档出发。材料 → 实体为 has_entity，材料 → 标签为 has_tag；从实体找材料用 incoming/both。document 节点 ID 使用 query/search/read 返回的 document_id，标签 ID 使用 resolve 返回的 tag_id，不使用画布临时 ID。
- 找共同材料：intersection 接收 2–5 个不同 entity/tag 节点；看范围分布用 overview。要列全量材料或搜索正文，用 query/search 的 entity_ids 过滤，不能把有节点预算的邻接图当全量清单。
- results 每项为一条边，按文档 ID 去重材料，保留边的 provenance 和版本。先一跳，按问题选择节点继续；扩展时保留日期等研究范围，范围变化需说明。
- 检查 graph_index.complete/pending_documents、traversal_truncated、next_cursor；实体筛选的 query/search 还要检查 coverage.entity_index。分页耗尽不等于完整邻域，空结果也可能来自索引未完成或范围限制。
- 支持/反驳关系沿 frontmatter 声明方向。通过 read 的 outline → blocks 获取原文、block_id 和页码，区分共现线索、库内声明关系、已读证据。只读研究不修改别名映射，将歧义和候选映射交给维护流程。
- 证券 → 发行人使用 `relation_types=["issued_by"]`；沿该边获得公司 ID 后，再查询公司材料。`subsidiary_of`、`product_of`、`supplies_to` 只返回维护者录入的来源事实，未录入不代表不存在。证券、发行人和母子公司不能合并为同一实体。
- 业务关系检查 provenance.source、observed_at、valid_from/valid_to、evidence。observed_at 是核验/来源快照日期，不是关系开始日期；有效期未知时为 null。`relation_as_of=YYYY-MM-DD` 排除有效期未知及该日之后核验的关系，不是完整历史知识回放。有材料 filters 时，业务关系两端都必须有范围内材料，可能减少结果。

## CLI 示例

以下标签值仅是示例，先查询实际标签：

```powershell
node scripts/agent/cli.mjs describe
node scripts/agent/cli.mjs resolve "半导体" --kind tag
node scripts/agent/cli.mjs resolve "英伟达" --kind entity --entity-type company
node scripts/agent/cli.mjs graph --operation overview --group-by category
node scripts/agent/cli.mjs query --tag "行业:半导体" --limit 20
node scripts/agent/cli.mjs search "资本开支" --tag "行业:半导体" --mode hybrid --explain
node scripts/agent/cli.mjs read "doc:实际ID" --view outline
node scripts/agent/cli.mjs read "doc:实际ID" --revision-id "实际版本" --view blocks --page 12
node scripts/agent/cli.mjs query --request query.json
```

复杂条件通过 UTF-8 JSON 文件或 `--request -` 的 stdin 传入。例如：

```json
{
  "filters": { "all": [
    { "field": "tags", "op": "contains_all", "value": ["行业:半导体"] },
    { "field": "published_at", "op": "gte", "value": "2026-07-01" }
  ] },
  "sort": "published_at", "direction": "desc", "limit": 20
}
```

连接不可用时报告 SERVICE_UNAVAILABLE；索引缺失时报告 INDEX_NOT_READY 并给出 `npm run research:index` 的维护命令。不要在只读研究过程中擅自启动全库解析、整理或向量化。
