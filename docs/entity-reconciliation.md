# 实体与别名批量治理

这是本机维护流程，远程 Agent 保持只读。原文、原始 tags、companies、tickers 不变；只更新可撤销的身份映射和图谱成员关系。

## 数据与规则

实体数据属于各实例本地文件，不随 Git 分发。缺少实体映射、上下文规则或业务关系文件时，服务使用对应的空配置；已有原始名称仍保留为 observed，补充核验后再建立别名映射。格式错误的配置仍会报错，不会被当成空词表。

首次维护前可运行以下命令创建空文件；已有文件不会被覆盖：

```powershell
$entityEmptyFiles = @{
  'entity-registry.json' = '{"version":1,"entities":[]}'
  'entity-masterdata.json' = '{"version":1,"sources":[],"entities":[]}'
  'entity-reviewed-aliases.json' = '{"version":1,"entities":[]}'
  'entity-reviewed-additions.json' = '{"version":1,"entities":[]}'
  'entity-context-rules.json' = '{"version":1,"entities":[],"context_rules":[]}'
  'entity-relations.json' = '{"version":1,"sources":[],"relations":[]}'
}
foreach ($entry in $entityEmptyFiles.GetEnumerator()) {
  $entityFile = Join-Path 'config' $entry.Key
  if (-not (Test-Path -LiteralPath $entityFile)) {
    Set-Content -LiteralPath $entityFile -Value $entry.Value -Encoding utf8
  }
}
```

主数据、人工别名、硬编码本机词表生成脚本、真实实体回归样本及库内治理统计已加入 `.gitignore`。`build-reviewed-entity-seeds.mjs` 是本机维护工具，源码仓库不提供；其他部署直接维护自己的 reviewed-aliases 文件。通用回归测试使用合成样本；只有本机具备完整实体数据与 `tests/fixtures/entity-quality.json` 时，才设置 `RESEARCH_ENTITY_LOCAL_TEST=1` 运行词表回归。

- `config/entity-masterdata.json`：SEC、深交所、上交所、台湾证券交易所、港交所公开名单的本次快照。记录来源 URL、下载时间和 SHA256；离线维护使用，不进入每次图查询。
- `config/entity-reviewed-aliases.json`：经逐项核对的高频公司别名、跨来源 ID 对照和受控术语。公司与证券分开；公司集团、子公司、品牌边界有疑问时分别保留。
- `config/entity-reviewed-additions.json`：后续追加核验结果。种子生成器会合入此文件，保留新增来源，不覆盖成最初版本。
- `config/entity-registry.json`：实际生效的标准实体和精确别名。自动加入的名称有 alias_evidence，记录匹配依据。已有实体 ID 保持稳定。

批量程序只批准唯一官方/核对名称、排版差异，以及名称与证券发行人同时匹配的“公司名（代码）”。移除法律后缀单独匹配只产生候选；Holdings 等主体限定词不删除。缺少市场的裸代码不映射；公司括号中的裸代码仅在公司名称也独立吻合时可确认。短缩写未经核对不直接采用。多个身份共享别名则保留歧义。

已自动推导的别名只用于精确匹配，不再次作为推导其他别名的依据，避免反复运行使合并范围越来越大。脚本验证每个待核对项不会意外落入唯一标准实体。

## 操作

```powershell
# 扫描活动版本，生成完整决策清单、统计和待应用映射；不改当前映射。
npm run research:entities:reconcile

# 核对输出，校验歧义，再备份并原子替换映射。
npm run research:entities -- validate work/entity-reconciliation/registry.proposed.json
npm run research:entities -- apply work/entity-reconciliation/registry.proposed.json
npm run research:graph-index

# 核查生效结果，并生成带代表材料标题/版本的高频待核对清单。
node scripts/query/entity-audit.mjs work/entity-reconciliation/after

# 导出高频待核验公司的有界取证包（类型可换 security / industry / subfield）。
node scripts/query/entity-review-context.mjs work/entity-reconciliation/decisions.json work/entity-review-context company 20
```

完整 `decisions.json` 对每个“类型＋规范化名称”记录映射或暂缓原因、材料数量及候选 ID。`pending-top200.md` 便于人工浏览，配套 audit.json 保存文档 ID 和 revision_id。名称数不等于实体数，同一份材料可能仍含多个未确认名称。

取证包最多处理 100 个名称，每个取 3 份不同 family_id 的材料，每份只读取前 40 个正文块的前 4,000 字符，输出片段最多 700 字符。JSON 同时记录候选身份、官方来源、证券代码、文档版本、正文块和页码；Markdown 便于浏览。未在取样范围找到名称不表示全文没有；共现和标题本身不批准身份合并。取证内容不发送给外部 LLM。

2026-09-18 起，已登记证券自动派生有限的、带市场的等价写法，例如 `700.HK`、`00700 HK`、`HK:700`、`700HK`。图谱入库和 Agent 精确解析共用同一套别名索引，新材料不必等下一轮人工登记这些格式。A 股、港股、美股和台湾市场分别处理；美股交易所后缀须匹配已登记交易所。`NVDA`、`700` 等裸代码仍不据此猜测市场；人民币与港币柜台保持不同证券 ID。

撤销：修正完整映射表或使用 apply 输出的备份重新 apply，然后刷新图谱。维护者确认的别名应沉淀到 reviewed-aliases；自动生成的别名证据不能冒充人工确认。主数据快照升级应重新审核冲突，不覆盖实体 ID。

## 更新官方快照

原始快照位于 `work/entity-sources/`，来源地址见主数据 sources。下载新名单后可用标准库 XLSX 解析器和离线生成器重建：

```powershell
python scripts/query/read-xlsx-rows.py work/entity-sources/szse.xlsx work/entity-sources/szse-rows.json
python scripts/query/read-xlsx-rows.py work/entity-sources/hkex.xlsx work/entity-sources/hkex-rows.json
node scripts/query/prepare-entity-masterdata.mjs work/entity-sources
# 手工维护本实例的 config/entity-reviewed-aliases.json 后，再运行治理流程。
```

本轮未调用 LLM，也未将知识库正文发送给外部服务。以上名单是现时身份辅助信息，并非历史时点数据库：曾用证券代码、退市主体、更名有效日期不能据此自动推定。港交所证券简称不自动等于发行人全称，缺乏发行人证据时保留证券实体。

剩余名称按“无主数据命中、名称/代码未同时确认、后缀近似、市场不明确、复合名称、缩写歧义”等原因进入待核对清单。下一轮应读取少量代表上下文或补充相应市场官方主数据；上下位概念通过关系表达，不能作为别名合并。

## 性能与验证

名称查找在内存哈希表上执行，避免对全库名称逐个遍历主数据。图谱投影用数据库索引定位受影响的名称和材料，在事务内同时发布实体目录、别名和成员关系。初次升级投影 v2 回填元数据，之后只处理变更文档与变更别名涉及的文档。

回归测试覆盖跨市场、前导零、发行人冲突、集团名称、短缩写、歧义保留、稳定 ID、重复治理不扩大范围，以及新增/撤销别名时仅更新受影响材料。Agent 的节点、边、跳数和输出预算继续生效。
