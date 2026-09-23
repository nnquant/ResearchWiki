# Wiki 研报广告清理

历史清理范围：2026-09-23 已解析、已进入 `wiki/sources` 且带原始 PDF 页码的研报正文。后续入库也默认执行同一套清理规则。

原始 PDF、下载文件、MinerU Markdown、图片文件、页码映射、文档主键和原始 SHA256 均不修改。只从 Wiki 派生正文中移除第三方推广文字、已人工确认的广告图片引用和清空后的广告页；余下页码沿用原 PDF 页码。元数据、标题、券商免责声明、作者联系方式和非广告图表保持原状。

## 规则与审计

- `scripts/wiki-ad-cleanup.mjs`：精确广告片段匹配，保留混排行中的研究文字；不按“第一页”“二维码”“广告”泛化删除。
- `config/wiki-ad-cleanup.json`：人工逐张核对过的 326 种推广海报指纹，不自动学习图片黑名单。
- `scripts/clean-wiki-advertisements.mjs`：默认预览，`--apply` 要求两条后台队列进入本批次维护暂停，并获取导入锁；写入前保存原文及逐项删除日志。
- 每个改动页面添加 `wiki_ad_cleanup` 审计字段；既有研究元数据不变。
- `work/wiki-ad-cleanup-20260923/backup` 与 `journal.jsonl` 保存原 Wiki 和前后 SHA256，可据此按文件恢复。恢复前必须再次核对当前文件 SHA256，不能覆盖后续人工或模型编辑。
- `result.json`、`verification.json`、`residuals.json` 分别记录执行、验证及保守保留项。本批次完成后禁止直接覆盖同目录的执行结果。

## 检索

带已知清理版本标记的 Wiki 页面，其 `research_query` 全文和证据索引使用清洁 Wiki 的 PDF 正文区，保留原 PDF 页码；原解析文件仍可从 provenance 找到。未标记文献仍使用原有路径。既有证据版本保留，不破坏历史引用。

`scripts/project-wiki-ad-cleanup.mts` 按字符级删除位置更新已存在的 GBrain 页面及分块，保留原分块位置和未变化向量；空广告块删除，变化块清空旧向量。投影前验证每个分块确实能映射回原正文，更新前保存页面及受影响分块备份。旧索引与正文不对应的 3 篇通过 `scripts/sync-wiki-ad-cleanup.mts --defer-embeddings --only-projection-errors` 原生导入回退完成。

`scripts/embed-wiki-ad-cleanup.mts` 只补算本批清理标记页面上的 NULL 向量，使用现有内网 bge-m3 接口和既有上下文包装方式；每次单路请求，遇到 502 拆分批次定位，不修改原句来绕过失败。写回前核对正文摘要、标题和上下文模式，保证不覆盖并发更新；已成功写回的向量重跑时自动跳过。它不调用 DeepSeek。部分文本单条请求仍返回 502，本次正文/全文索引清理完成，但语义向量补算尚未完成，详见本次报告。

## 后续自动入库

`parseRecord` 在转换 Markdown、重写图片路径之后，写 Wiki 和建立索引之前调用 `prepareWikiSource`。PDF、HTML、Markdown、TXT 共用这一入口，普通导入、后台发现、仅解析模式和失败重试均覆盖。无分页正文使用相同的精确广告规则，保留原有 YAML；PDF 页码不重排。无命中也记录已检查，清理或审计写入失败则停止本次入库，不静默跳过。

每次检查在 Wiki frontmatter 写入版本、时间、前后正文 SHA256、删除数量和审计路径，详细删除记录位于 `state/wiki-ad-cleanup/<id>/<revision>.json`。重试同一版本会更新该记录；原解析文件一直保留，可重建清理前正文。人工未确认的图片只记录为候选，不自动删除。

新增页面用不可见正文边界标记区分来源正文与 Wiki 生成的来源说明，全文索引读取边界后的清洁正文，GBrain 按原流程导入清洁 Wiki。补充元数据沿用当前 Wiki 正文与清理标记，旧暂存结果仍须通过页面哈希检查才能发布。结构化抽取使用的原解析输入及其哈希契约不变。本次没有修改原件、重新 OCR 或重新提取研究结论。
