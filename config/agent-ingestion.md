# Agent 录入文献与投资研究

本分支面向公司、行业与宏观研究。文献字段保留原文事实；主观判断单独创建研究页面。

研究页面通过 POST `/api/pages` 创建，例如：

```json
{
  "type": "company",
  "title": "示例公司研究",
  "tags": ["消费"],
  "research": { "research_stage": "draft", "as_of": null, "next_review": null, "region": "中国", "tickers": [], "horizon": "未来 12 个月" },
  "relations": {}
}
```

类型支持 company / industry / macro / event / valuation / meeting / theme / claim 等。`research` 字段契约见 `config/research-fields.json`，日期和阶段校验失败返回 422；空值不自动推断。研究阶段不代表事实核验结果。创建返回 201 和 `job_id`，读取 `/api/page/<slug>/raw` 后用 PUT `/api/page/<slug>` 提交完整 `content` 与 `base_hash` 更新；索引任务须完成后再验证检索与关联图。

`about` 指向研究对象，`belongs_to` 指向行业或主题，`impacts` 指向受影响对象，`compares_with` 指向比较对象；证据使用 `derived_from` / `supported_by` / `contradicted_by`。relations 的值为已存在页面 slug 的数组。资料库支持 `stage=tracking`、`due=true` 以及按标题、代码、别名、地区的 `q` 筛选。

字段契约：`config/article-metadata.schema.json`（也可 GET `/api/article-schema`）。字段全部可选；未知值用 null，空字符串和空数组会归一化为空。只有有值的扩展字段显示在文献详情页。

1. 获取并保存原件。PDF 使用 MinerU，网页使用 Defuddle，IMA 使用 ima-skill 对接的现有导入流程。
2. 阅读解析后的全文，再填写 metadata。已掌握且有依据的字段可随首次导入提交；PDF 通常先导入、读 Markdown，再补充。
3. 作者、机构、DOI、arXiv ID、日期等必须依据原文或可核实的来源。原文只有年份时，用 sample_period 保存原始描述，不捏造 sample_start / sample_end 的具体日期。
4. abstract 是原文摘要；没有明确摘要就留空。key_findings 记录原文结论，key_evidence 附 PDF 页号或章节。推断和自己的研究观点应写关联笔记，并标明推断，不混入原文结论。
5. personal_rating 为 0–5 分，只在用户给出评分或明确评分规则时填写；不自动生成“个人评分”。未完成研究核验，不设为 verified。
6. 不确定就留空，不为填写齐全而猜测。省略字段表示保留原值，显式 null 表示清空。
7. 日期字段只接受证据中明确的完整年月日；例如原文只有 August 2026 时，published_at 留空，不补成 2026-08-01。自动主题标签会保留来源和文献分类，显式提供的标签优先。

命令在项目目录执行：

```powershell
node scripts/wiki.mjs add-file "文章.pdf" --metadata-file "文献信息.json"
node scripts/wiki.mjs add-url "https://example.com/article" --metadata-file "文献信息.json"
node scripts/wiki.mjs set-metadata "sources/文献ID" --metadata-file "文献信息.json"
node scripts/wiki.mjs index
```

CLI 导入、更新字段后需运行 index。更新字段不重新 OCR，也不改写 raw/parsed 原件。索引读取 frontmatter，正文仍保留原文。

本机 HTTP：先 GET `/api/status` 获取 csrf，在写请求中使用 `x-wiki-token`。
- POST `/api/import/url`：`{"url":"...","metadata":{...}}`。
- 文件上传、IMA 导入完成后，PUT `/api/page/sources/文献ID/metadata`：`{"metadata":{...}}`。
- 写接口返回 202 任务记录；轮询 `/api/jobs/<id>`，确认 done，再读取文献验证。HTTP 写入自动更新索引。

当前 GBrain MCP 仍是只读；录入 Agent 通过上述本机 CLI 或受保护的 HTTP 接口写入。

文章自动整理已接入用户指定的 `qwen3.8-27b-uncensored-fp8`，运行配置和凭据只放在数据目录 `runtime/article-llm.json`。enabled 为 true 时，导入流程会在解析完成后、生成 Wiki 全文页前调用模型。整篇 Markdown 一次提交并提取字段，不分段、不截断。`contextTokens` 默认 262144，`maxInputTokens` 默认 200000，同时预留提示词和输出余量。token 为启发式估算，并非精确 tokenizer 计数；超过预算或服务端拒绝上下文长度时明确报错，保留原文等待更大上下文配置。`requestTimeoutMs` 默认 600000。处理模式、全文范围、输入哈希、模型响应、字段证据和丢弃原因保存在 `state/llm/`。新模式使用独立缓存，旧报告保留；相同输入可复用新模式结果。非空字段需要匹配原文的证据引用；模型不会设置个人评分或研究验证状态。用户显式提供的 metadata 优先于自动结果。

继续获取下一批新资料：`node scripts/wiki.mjs ima-import --next --limit 3`，然后运行 index。网页 IMA 导入也会跳过已入库资料，数量表示最多导入的新资料数。模型失败时保留原件及解析结果；`parse-pending` 可续跑，复用已解析 PDF 和成功的全文模型结果。
