---
name: researchwiki
description: 查询 ResearchWiki 投资研究知识库，按公司代码、领域标签、机构和日期寻找材料，检索正文并读取带版本和页码的原文证据。
---

# ResearchWiki 研究材料接入

优先使用已连接的 `research_*` MCP 工具。远程入口是服务端 `http(s)://<服务器>/mcp`（Streamable HTTP、Bearer 鉴权）；也可在轻量客户端目录运行 `node scripts/agent/cli.mjs`，通过 `RESEARCHWIKI_URL` 和 `RESEARCHWIKI_TOKEN_FILE`（或 `RESEARCHWIKI_TOKEN`）连接。CLI help 返回完整工具 schema，stdout 是 JSON。Skill 本身不建立连接；连接设置见 [接入说明](../../docs/agent-access.md)。远程 Agent 无需知识库文件、数据库或模型环境。

- 初次访问用 `research_describe` 查看真实能力和索引覆盖。
- 401 表示凭据缺失或失效，429 按 Retry-After 退避；不要通过读取服务器私有配置或直连数据库绕过接入接口。不要在日志、URL 或回复中输出 token。
- 原件 `raw_url` 是网络下载地址，下载请求仍需 Bearer；仅向管理员配置的知识库服务源发送凭据。`open_url=null` 表示未配置可达的网页阅读器，继续使用 `research_read`。provenance 中的路径是服务端来源记录，不是客户端磁盘路径。
- 用户提及标签、公司代码或领域时，用 `research_resolve` 的 `kind=tag` 或 `research_describe(section=tags,q=...)` 查实际标签。公司标签可能包含全名和代码；多个候选不要擅自合并。
- 需要“全部报告”、计数或分组时用 `research_query`；按问题找相关材料时用 `research_search`。标签条件同样适用于两者。
- 标签支持 `contains_all`（交集）、`contains_any`（并集）、`contains_none`（排除）。组合条件用 `filters.all/any/not`。缺少标签不代表正文不涉及；扩展搜索范围时明确说明。
- 搜索卡是发现线索。引用前使用 `research_read`，带上 document_id、revision_id 和 block_id。首次阅读长文用 outline，然后选 blocks；表格、公式、脚注保留在原文中。
- PDF 页码是解析器标记的物理页；网页可以只有正文块定位。无证据定位的文档命中需要进一步阅读，不能猜页码。
- 查询响应中的 next_cursor 表示尚有结果。翻页只传 cursor 及 limit/预算，不改变条件；10 分钟或服务重启后游标可能失效。
- `research_related` 读取明确写入的关系。支持/反驳关系是库内记录，仍需阅读来源；正文提及不等于支持结论。
- 检查 coverage、degraded、empty_reason 和 query_plan。未完成索引或向量失败时不能把零结果说成“库里没有”。lexical 模式无需模型；deep 当前只扩大候选，不具备生成式扩展或交叉编码器重排。
- 日期范围是记录的发布日期，不是历史时点知识回放。原文、译文、阅读卡不是独立的多份证据。

## CLI 示例

以下标签值仅是示例，先查询实际标签：

```powershell
node scripts/agent/cli.mjs describe
node scripts/agent/cli.mjs resolve "半导体" --kind tag
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
