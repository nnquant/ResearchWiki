import fs from 'node:fs/promises';
import { dataPath,ensureDirs,manifest } from './common.mjs';
await ensureDirs();
const pages={
  'index':`---\ntitle: 投资研究 Wiki\ntype: note\n---\n# 投资研究 Wiki\n\n这是投研 Agent 的证据与长期知识层。\n\n- [[concepts/研究方法]]：公司、行业、宏观研究与观点复核。\n- [[concepts/证据与引用]]：原文、页码、时间和来源。\n- [[concepts/Agent使用协议]]：查询、读取与研究结论的保存方式。\n\n## 资料来源\n\nPDF → MinerU → Markdown / JSON / 图表 / 页码；网页 → Defuddle → Markdown；IMA → ima-skill → 原件。\n\n行情、财务数值和估值模型继续放在各自的数据系统，本 Wiki 保存其定义、研究结论和数据入口。`,
  'concepts/研究方法':`---\ntitle: 研究方法\ntype: concept\naliases: [基本面研究, 行业研究, 宏观研究, 公司研究]\n---\n# 研究方法\n\n研究从明确的问题与投资论点开始，记录市场共识、预期差、证据与反方解释，再跟踪经营数据和事件如何改变判断。\n\n## 研究记录\n\n- 公司：商业模式、竞争优势、财务质量、估值与公司治理。\n- 行业：产业链、供需、库存、价格、竞争格局与资本开支。\n- 宏观：增长、通胀、信用、政策与资产传导，区分统计期、发布日期和修订值。\n- 证据：链接原文、数据与估值模型，区分原始事实、外部观点与研究推断。\n- 跟踪：待研究、持续跟踪、已复核、已归档。记录资料截至日和下次复核日期，保留历史判断与改变原因。\n\n## 证据关系\n\n研究结论遵循 [[concepts/证据与引用]]。Agent 的查询和写回方式见 [[concepts/Agent使用协议]]。\n\n复核是研究工作进度，不代表投资论点已被证明。每个观点都应写清催化剂、风险与证伪条件。`,
  'concepts/证据与引用':`---\ntitle: 证据与引用\ntype: concept\naliases: [来源追溯, provenance, citation, 引用页码]\n---\n# 证据与引用\n\n每个研究结论都应能追溯到文档、原始链接、接收时间和具体页码。接收时间不能替代资料的发布日期。\n\n## 原文证据\n\n原始文件按 SHA-256 校验并保留。PDF 的 Markdown 与 JSON 均由 MinerU 生成，page-map.json 把内容块映射到从 1 开始的 PDF 页码。引用具体观点时核对原始 PDF；目录及 PDF 印刷页码可能与文件页号不同。\n\n## 观点与事实\n\n原文观点、Agent 推断、已验证研究结论必须区分。相反观点分别保留来源，不静默覆盖。网页正文若不可访问，应标记失败并保留来源线索。\n\n## 研究页面\n\ncompany / industry / macro 保存公司、行业与宏观研究；claim 保存观点与支持/反对证据；event 跟踪事件；valuation 保存估值假设与模型入口；meeting 保存调研陈述和待核实信息。about、belongs_to、impacts、compares_with 连接研究对象与影响路径。详见 [[concepts/研究方法]]。`,
  'concepts/Agent使用协议':`---\ntitle: Agent 使用协议\ntype: concept\naliases: [MCP, Agent, research agent]\n---\n# Agent 使用协议\n\nGBrain 是检索、来源、关联和长期研究记录层。行情和精确数值从专门数据工具查询。\n\n## 查询流程\n\n1. 精确论文名、代码和术语用 search；跨文档问题用 query。\n2. 使用 get_page 读取命中页面，并打开原始文件核对关键证据。\n3. 精确数据从行情、财务与宏观数据工具获取，计算过程保留在估值模型中。\n4. 给出明确引用，并区分原文观点、研究推断和已验证结果。\n\n## 保存研究\n\n普通研究 Agent 先把新结论写到 drafts/，附原件来源与页码；审核后再提升到 companies/、industries/、macro/、claims/、events/、valuations/ 或 meetings/。原件不会被 Agent 改写。\n\nMCP 初始提供只读检索接入；需要写回时使用受 drafts/ 前缀限制的独立客户端。\n\n普通 LLM 的综合回答由调用方 Agent 完成。本地 bge-m3 embedding 用于语义检索；当前未启用 LLM 自动抽取或综合。\n\n参考 [[concepts/证据与引用]] 与 [[concepts/研究方法]]。`
};
for(const [slug,text] of Object.entries(pages)) {
  try{await fs.writeFile(dataPath('wiki',slug+'.md'),text+'\n',{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}
}
const m=await manifest();
const catalog=`---\ntitle: 文献目录\ntype: note\n---\n# 文献目录\n\n${Object.values(m.documents).filter(x=>x.wiki_slug).map(x=>`- [[${x.wiki_slug}|${x.title}]]`).join('\n')}\n\n[[concepts/研究方法|研究方法]]\n`;
await fs.writeFile(dataPath('wiki','文献目录.md'),catalog);
console.log('研究导航与使用规范已保存');
