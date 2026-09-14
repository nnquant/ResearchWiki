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

`research_category` 指定页面归属：company 公司研究、industry 行业研究、macro 宏观研究、theme 投资主题、event 事件跟踪、valuation 估值分析、meeting 调研纪要、strategy 策略、source 待分类文献。按主要研究对象选择一个；单家公司财报和评级报告通常归入 company。`document_type` 继续保存研报、论文等载体类型。旧文献和未填写分类的新文献由标题及研究主题/标签规则归类，无法确定时保留待分类；显式分类优先。侧栏、首页计数、资料库 type 筛选及阅读页分类导航使用相同的 category 字段；底层 source 类型和原文 URL 保持稳定。

研究对象分别存为 `companies`（涉及公司）、`industries`（涉及行业）、`subfields`（细分技术/产品/应用，例如 HBM、GPU、CPU、AI）字符串数组。只收录正文实质讨论的对象，排除券商署名、广告和免责声明；未涉及用 null。模型返回实体与证据一体的 `{name,quote,page}` 对象，系统转换为字符串数组和带 `field,item,quote,page` 的逐项证据；兼容旧版逐项证据格式。公司优先保留原文名称和证券代码，不猜测中文名。证据校验兼容 HTML 表格、实体转义及 Markdown 转义，但仍要求文字、数字和文件页号匹配。系统生成 `公司:`、`行业:`、`领域:` 标签供点击筛选和索引。后台批处理跳过所有已完成抽取并索引的文献；新增字段仅用于后续待处理报告，不因字段版本升级补抽历史文献。

公司报告通过 `analyst_expectations` 按公司保存原始评级及看多/中性/看空方向、目标价与币种、预测期和营收/净利润/EPS 等预测。保留原始财年标签、金额单位及券商预测与一致预期的区别；评级方向按原始评级归类，未评级不当作中性。数字、年度及评级须附原文引文和文件页号，无法核实的条目不入库；原文没有给出的预测或目标价留空。文献详情页展示这些字段及证据。

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

文章自动整理使用独立的私有配置。导入流程读取数据目录 `runtime/article-llm.json`，enabled 为 true 时在解析完成后、生成 Wiki 全文页前调用模型；独立批处理通过 `--config` 指定配置，本机使用 Git 忽略的 `work/article-llm.json`。当前批处理使用本地 DeepSeek V4 Flash（服务模型 ID 为 deepseek-v4-flash-uncensored），关闭思考，offPeakOnly=false。官方服务配置如启用 offPeakOnly，每次请求与重试均检查北京时间非高峰窗口。整篇 Markdown 一次提交并提取字段，不分段、不截断。通用默认 `contextTokens=262144`、`maxInputTokens=200000`；本地服务沿用通用默认预算，并预留提示词和输出余量。token 为启发式估算，并非精确 tokenizer 计数；超过预算或服务端拒绝上下文长度时明确报错，保留原文。`requestTimeoutMs` 默认 600000。处理模式、全文范围、输入哈希、模型响应、请求耗时、字段证据和丢弃原因保存在审计文件中。提示词版本 `article-fields-v8-inline-proof`；验证失败最多反馈具体缺失字段重试一次；HTTP 401/402/403 立即停止批处理，不继续尝试后续文章。仅确定性的 JSON 字符串控制字符可自动转义，歧义引号或截断输出不猜测修复。成功抽取在索引失败后复用；旧版本失败记录允许重新排队，已完成记录保留。非空字段需要匹配原文证据；模型不会设置个人评分或研究验证状态。用户显式提供的 metadata 优先于自动结果。

文章工作进程遇到临时连接故障、请求超时、HTTP 408/429/500/502/503/504 时进入 `waiting_service`，保留当前文章为待续跑，不计作内容抽取失败。按 30、60、120、240 秒退避，之后最长每 300 秒检查一次配置接口的 `/models`；响应成功且包含当前模型后自动继续。等待状态持久保存在 `state/article-enrichment/service-recovery.json`，进程重新启动后可继续等待。检查期间不提交文章或切换供应商；用户暂停优先，401/402/403 仍停止并等待处理。已保存的抽取及索引缓存继续复用；错误审计增加底层连接错误码和单次耗时。此机制在工作进程运行期间生效，不负责开机自启或重启崩溃进程。

继续获取下一批新资料：`node scripts/wiki.mjs ima-import --next --limit 3`，然后运行 index。网页 IMA 导入也会跳过已入库资料，数量表示最多导入的新资料数。模型失败时保留原件及解析结果；`parse-pending` 可续跑，复用已解析 PDF 和成功的全文模型结果。
