import fs from 'node:fs/promises';
import { dataPath,ensureDirs,manifest } from './common.mjs';
await ensureDirs();
const pages={
  'index':`---\ntitle: 量化研究 Wiki\ntype: note\n---\n# 量化研究 Wiki\n\n这是投研 Agent 的证据与长期知识层。\n\n- [[concepts/研究方法]]：假设、样本外验证和研究状态。\n- [[concepts/证据与引用]]：原文、页码、时间和来源。\n- [[concepts/Agent使用协议]]：查询、读取与研究结论的保存方式。\n\n## 资料来源\n\nPDF → MinerU → Markdown / JSON / 图表 / 页码；网页 → Defuddle → Markdown；IMA → ima-skill → 原件。\n\n行情、财务、因子数值和回测明细继续放在各自的数据系统，本 Wiki 保存其定义、研究结论和数据入口。`,
  'concepts/研究方法':`---\ntitle: 研究方法\ntype: concept\naliases: [量化研究, 样本外验证, 回测规范]\n---\n# 研究方法\n\n研究从可证伪假设开始，先记录机制、预测、数据口径和失败条件，再观察实验结果。\n\n## 研究记录\n\n- 假设：为什么可能成立，什么证据会推翻它。\n- 数据：样本区间、字段、可得时间、股票池、复权、缺失值和交易限制。\n- 验证：训练与测试区间、样本外表现、交易成本、参数稳定性、集中度和实际试验次数。\n- 结果：链接因子值、IC、分组收益、净值、信号、成交和原始配置。\n- 状态：待验证、进行中、待样本外、通过、归档。失败结果保留原因，不反复调参直至通过。\n\n## 证据关系\n\n研究结论遵循 [[concepts/证据与引用]]。Agent 的查询和写回方式见 [[concepts/Agent使用协议]]。\n\n这里是工作约定，不构成任何策略已通过验证的证据。`,
  'concepts/证据与引用':`---\ntitle: 证据与引用\ntype: concept\naliases: [来源追溯, provenance, citation, 引用页码]\n---\n# 证据与引用\n\n每个研究结论都应能追溯到文档、原始链接、接收时间和具体页码。接收时间不能替代资料的发布日期。\n\n## 原文证据\n\n原始文件按 SHA-256 校验并保留。PDF 的 Markdown 与 JSON 均由 MinerU 生成，page-map.json 把内容块映射到从 1 开始的 PDF 页码。引用具体观点时核对原始 PDF；目录及 PDF 印刷页码可能与文件页号不同。\n\n## 观点与事实\n\n原文观点、Agent 推断、已验证研究结论必须区分。相反观点分别保留来源，不静默覆盖。网页正文若不可访问，应标记失败并保留来源线索。\n\n## 研究页面\n\nclaim 保存观点与支持/反对证据；hypothesis 保存可证伪预测；factor 保存公式与数据字段；strategy 保存信号与执行假设；experiment 保存配置、日期、指标和明细路径。详见 [[concepts/研究方法]]。`,
  'concepts/Agent使用协议':`---\ntitle: Agent 使用协议\ntype: concept\naliases: [MCP, Agent, research agent]\n---\n# Agent 使用协议\n\nGBrain 是检索、来源、关联和长期研究记录层。行情和精确数值从专门数据工具查询。\n\n## 查询流程\n\n1. 精确论文名、代码和术语用 search；跨文档问题用 query。\n2. 使用 get_page 读取命中页面，并打开原始文件核对关键证据。\n3. 精确数据和策略表现从行情、财务、因子与回测工具获取。\n4. 给出明确引用，并区分原文观点、研究推断和已验证结果。\n\n## 保存研究\n\n普通研究 Agent 先把新结论写到 drafts/，附原件来源与页码；审核后再提升到 claims/、hypotheses/、factors/、strategies/ 或 experiments/。原件不会被 Agent 改写。\n\nMCP 初始提供只读检索接入；需要写回时使用受 drafts/ 前缀限制的独立客户端。\n\n普通 LLM 的综合回答由调用方 Agent 完成。本地 bge-m3 embedding 用于语义检索；当前未启用 LLM 自动抽取或综合。\n\n参考 [[concepts/证据与引用]] 与 [[concepts/研究方法]]。`
};
for(const [slug,text] of Object.entries(pages)) {
  try{await fs.writeFile(dataPath('wiki',slug+'.md'),text+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
}
const m=await manifest();
const catalog=`---\ntitle: 文献目录\ntype: note\n---\n# 文献目录\n\n${Object.values(m.documents).filter(x=>x.wiki_slug).map(x=>`- [[${x.wiki_slug}|${x.title}]]`).join('\n')}\n\n[[concepts/研究方法|研究方法]]\n`;
await fs.writeFile(dataPath('wiki','文献目录.md'),catalog);
console.log('研究导航与使用规范已保存');
