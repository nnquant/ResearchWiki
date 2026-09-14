import {articleCategory} from './article-category.mjs';
import {normalizeArticleMetadata} from './article-metadata.mjs';
import {evidenceText} from './article-response.mjs';

export const EXPECTATIONS_VERSION='analyst-expectations-v1';
export const EXPECTATIONS_FIELD='analyst_expectations';
export function isCompanyReport(record) {return articleCategory({...record.article_metadata,title:record.title})==='company';}
export function needsExpectationsBackfill(record) {return record.llm?.status==='complete'&&isCompanyReport(record)&&record.llm.expectations_version!==EXPECTATIONS_VERSION;}
const financialText=value=>evidenceText(value).replace(/\\+(?=[$%])/g,'');
const compact=value=>financialText(value).toLowerCase().replace(/\s+/g,'');
const contains=(proofs,value)=>value!=null&&proofs.some(p=>compact(p.quote).includes(compact(value)));
const numeric=value=>[...String(value).normalize('NFKC').matchAll(/\(?[+-]?(?:\d[\d,]*(?:\.\d+)?|\.\d+)\)?/g)].map(m=>m[0].replaceAll(',','').replace(/^\((.*)\)$/,'-$1').replace(/^\+/,'').replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,''));
function numericSupported(proofs,value) {
  const wanted=numeric(value),seen=new Set(proofs.flatMap(p=>numeric(p.quote)));
  return wanted.length>0&&wanted.every(n=>seen.has(n))&&(!String(value).includes('%')||contains(proofs,value));
}
function currencySupported(proofs,value) {
  if(!value)return true;
  const names={USD:['USD','US$','U.S.$'],HKD:['HKD','HK$'],CNY:['CNY','RMB','人民币'],EUR:['EUR','€'],GBP:['GBP','£'],JPY:['JPY','日本円','日元'],KRW:['KRW','韩元']};
  return (names[value.toUpperCase()]??[value]).some(alias=>contains(proofs,alias));
}
function currencyFromProofs(proofs,value) {
  if(value&&currencySupported(proofs,value))return value;
  // Keep the literal symbol when the report does not specify which dollar currency.
  return proofs.some(p=>/(?<![A-Za-z])\$/.test(p.quote))?'$':null;
}
export function ratingStance(label) {
  const value=compact(label??'').replace(/[ -]/g,'');
  if(['buy','strongbuy','overweight','outperform','accumulate','positive','买入','增持','跑赢大市','优于大市','推荐','强烈推荐'].includes(value))return 'bullish';
  if(['hold','neutral','equalweight','marketperform','中性','持有','与大市同步'].includes(value))return 'neutral';
  if(['sell','underweight','underperform','reduce','negative','卖出','减持','跑输大市','弱于大市'].includes(value))return 'bearish';
  if(['notrated','unrated','nr','未评级','无评级'].includes(value))return 'not_rated';
  return null;
}

/** Quotes, numbers, periods and original labels must survive source verification independently. */
export function groundAnalystExpectations(input,text) {
  if(input==null||Array.isArray(input)&&input.length===0)return {value:null,discarded:[]};
  const source=text.replace(/\r\n/g,'\n');
  const pages=[...source.matchAll(/^## PDF 第 (\d+) 页\n([\s\S]*?)(?=^## PDF 第 \d+ 页$|$(?![\s\S]))/gm)].map(m=>({page:Number(m[1]),raw:m[2],text:financialText(m[2])}));
  const tables=pages.flatMap(page=>[...page.raw.matchAll(/<table\b[^>]*>[\s\S]*?<\/table>/gi)].map(match=>({page:page.page,text:financialText(match[0]),simple:!/(?:rowspan|colspan)\s*=/i.test(match[0]),rows:[...match[0].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(row=>[...row[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell=>financialText(cell[1]))),caption:financialText(page.raw.slice(0,match.index).trim().split('\n').at(-1)??'')})));
  const discarded=[],out=[];
  const reject=(item,reason)=>discarded.push({field:EXPECTATIONS_FIELD,item,reason});
  function proofs(items,company=false) {return items.filter(p=>{
    const quote=financialText(p.quote),matches=(body)=>company?compact(body).includes(compact(quote)):body.includes(quote);
    return quote.length>=3&&(pages.length?pages.some(page=>page.page===p.page&&matches(page.text)):matches(financialText(source)));
  }).map(p=>({...p,quote:financialText(p.quote)}));}
  if(!Array.isArray(input)){reject(null,'分析师预期必须是数组');return {value:null,discarded};}
  for(const [index,raw] of input.slice(0,10).entries()) {
    let entry;
    try{entry=normalizeArticleMetadata({analyst_expectations:[raw]}).analyst_expectations[0];}
    catch(error){reject(String(index),error.message);continue;}
    entry.evidence=proofs(entry.evidence,true);
    if(!contains(entry.evidence,entry.company)){reject(entry.company,'公司名称缺少匹配原文和页号的证据');continue;}
    if(entry.ticker&&!contains(entry.evidence,entry.ticker)){reject(entry.company+'.ticker','证券代码未出现在公司证据中');entry.ticker=null;}
    if(entry.rating) {
      const r=entry.rating;r.evidence=proofs(r.evidence);
      if(!r.evidence.length){reject(entry.company+'.rating','评级证据不匹配');entry.rating=null;}
      else {
        for(const key of ['label','previous_label'])if(r[key]&&!contains(r.evidence,r[key])){reject(entry.company+'.rating.'+key,'评级原文未出现在证据中');r[key]=null;}
        const mapped=ratingStance(r.label);
        if(r.stance_basis==='rating_mapping'||!r.stance_basis){r.stance=mapped;r.stance_basis=mapped?'rating_mapping':null;}
        else if(r.stance) {
          const words={bullish:/bullish|constructive|positive|看多|看好|乐观/i,bearish:/bearish|negative|看空|悲观/i,neutral:/neutral|中性/i,mixed:/mixed|分歧|多空交织/i,not_rated:/not rated|unrated|未评级/i};
          if(!words[r.stance]?.test(r.evidence.map(p=>p.quote).join(' '))){reject(entry.company+'.rating.stance','方向缺少明确观点或可映射评级');r.stance=null;r.stance_basis=null;}
        }
        const changes={upgraded:/upgrad|raised.{0,30}(rating|to)|上调评级|调升评级/i,downgraded:/downgrad|下调评级|调降评级/i,maintained:/maintain|reiterate|retain|remain|reaffirm|维持|重申/i,initiated:/initiat|首次覆盖|首予/i,suspended:/suspend|暂停评级/i};
        if(r.change&&!changes[r.change]?.test(r.evidence.map(p=>p.quote).join(' ')))r.change=null;
        if(!r.label&&!r.stance)entry.rating=null;
      }
    }
    if(entry.target_price) {
      const p=entry.target_price;p.evidence=proofs(p.evidence);
      if(!numericSupported(p.evidence,p.value)){reject(entry.company+'.target_price','目标价数字或证据页号不匹配');entry.target_price=null;}
      else {
        for(const key of ['previous_value','implied_upside'])if(p[key]&&!numericSupported(p.evidence,p[key])){reject(entry.company+'.target_price.'+key,'数字未出现在证据中，不能自行计算');p[key]=null;}
        if(!currencySupported(p.evidence,p.currency))reject(entry.company+'.target_price.currency','币种代码未在证据中明确，仅保留原文符号');
        p.currency=currencyFromProofs(p.evidence,p.currency);
        if(p.horizon&&!contains(p.evidence,p.horizon))p.horizon=null;
      }
    }
    entry.forecasts=(entry.forecasts??[]).filter(f=>{
      f.evidence=proofs(f.evidence);
      if(/(?:\d\s*A|actuals?|实际|已实现)$/i.test(f.period)){reject(entry.company+'.'+f.period,'历史实际值不能当作盈利预测');return false;}
      // Recover omitted headers only from the cited table, and verify the value's exact year column.
      let checkedColumn=false,matchedColumn=false;
      for(const table of tables) {
        if(!table.simple||!f.evidence.some(p=>p.page===table.page&&table.text.includes(p.quote)&&compact(p.quote).includes(compact(f.metric_label))))continue;
        for(let rowIndex=0;rowIndex<table.rows.length;rowIndex++) {
          const row=table.rows[rowIndex];if(compact(row[0]??'')!==compact(f.metric_label))continue;
          const header=table.rows.slice(0,rowIndex).reverse().find(cells=>cells.some(cell=>compact(cell)===compact(f.period)));
          if(!header||header.length!==row.length)continue;
          const columns=header.map((cell,i)=>compact(cell)===compact(f.period)?i:-1).filter(i=>i>=0);
          if(columns.length!==1)continue;
          checkedColumn=true;
          if(numeric(row[columns[0]]).join('|')!==numeric(f.value).join('|'))continue;
          matchedColumn=true;
          if(f.previous_value&&/\bnew\b/i.test(f.metric_label)) {
            const oldLabel=f.metric_label.replace(/\bnew\b/i,'Old');
            const oldRow=table.rows.find(cells=>compact(cells[0]??'')===compact(oldLabel));
            if(oldRow&&oldRow.length===header.length&&numeric(oldRow[columns[0]]).join('|')!==numeric(f.previous_value).join('|')) {
              reject(entry.company+'.'+f.period+'.previous_value','调整前预测值与原表年度列不对应');f.previous_value=null;
            }
          }
          if(!contains(f.evidence,f.period)&&f.evidence.length<6)f.evidence.push({quote:header.join(' ').trim(),page:table.page});
          if(table.caption.length<=200&&/(?:Rmb|RMB|USD|US\$|HKD|HK\$|CNY|EUR|GBP|JPY|million|billion|mn|bn|千元|万元|亿元)/.test(table.caption)&&f.evidence.length<6&&!contains(f.evidence,table.caption))f.evidence.push({quote:table.caption,page:table.page});
        }
      }
      if(checkedColumn&&!matchedColumn){reject(entry.company+'.'+f.period+'.'+f.metric,'预测数值与原表年度列不对应');return false;}
      if(!contains(f.evidence,f.period)||!contains(f.evidence,f.metric_label)||!numericSupported(f.evidence,f.value)){reject(entry.company+'.'+f.period+'.'+f.metric,'预测期间、原始指标或数字缺少匹配证据');return false;}
      if(f.previous_value&&!numericSupported(f.evidence,f.previous_value)){reject(entry.company+'.forecast.previous_value','调整前数值未出现在证据中');f.previous_value=null;}
      f.currency=currencyFromProofs(f.evidence,f.currency);
      // In ModelWare tables, ** describes the accounting methodology, while §
      // denotes external consensus. The e legend identifies the research estimates.
      for(const page of pages.filter(p=>f.evidence.some(e=>e.page===p.page&&compact(e.quote).includes(compact(f.metric_label))))) {
        const lines=page.raw.split('\n').map(line=>line.replace(/\\([*])/g,'$1').trim());
        const method=lines.find(line=>/^\*\*\s*=\s*Based on consensus methodology/i.test(line));
        const analyst=lines.find(line=>/^e\s*=\s*Morgan Stanley Research estimates\s*$/i.test(line));
        const consensus=lines.find(line=>/^§\s*=\s*Consensus data is provided by /i.test(line));
        let legend;
        if(/§\s*$/.test(f.metric_label)&&consensus){f.source='consensus';legend=consensus;}
        else if(/\*\*\s*$/.test(f.metric_label)&&/e$/i.test(f.period)&&method&&analyst){f.source='analyst';legend=analyst;}
        if(legend&&!contains(f.evidence,legend)&&f.evidence.length<6)f.evidence.push({quote:financialText(legend),page:page.page});
      }
      for(const key of ['unit','basis'])if(f[key]&&!contains(f.evidence,f[key]))f[key]=null;
      return true;
    });
    for(const key of ['key_assumptions','catalysts','risks'])entry[key]=(entry[key]??[]).map(note=>({...note,evidence:proofs(note.evidence)})).filter(note=>note.evidence.length);
    if(!entry.rating&&!entry.target_price&&!entry.forecasts.length&&!['key_assumptions','catalysts','risks'].some(key=>entry[key].length)){reject(entry.company,'未保留有证据的分析师预期');continue;}
    out.push(entry);
  }
  return {value:out.length?out:null,discarded};
}

export const expectationInstructions=`公司研究报告需提取 metadata.analyst_expectations，始终显式返回数组，无分析师预期时 []，不要编造。按主要覆盖公司分别保存，最多3家公司，不把同业比较表中所有公司抄入。公司名称和 ticker 保留原文，不凭记忆翻译。
每个公司以及 rating、target_price、每条 forecasts、每条假设/催化剂/风险都带 evidence:[{quote:"原文连续引文",page:文件页号}]，每组最多4条。公司顶层 evidence 证明公司名称和代码。表格引用需同时保留原始指标行、含年度和单位的表头，各自带页号；不得串列，不把已实现的 Actual/A 年份当作预测。
rating 保存 label 原始评级、previous_label 原评级、change(upgraded/downgraded/maintained/initiated/suspended)、stance(bullish/neutral/bearish/mixed/not_rated)、stance_basis(explicit_view/rating_mapping)、rationale(简短中文依据)。买入/增持/Outperform/Overweight可映射看多，Hold/Neutral/Equal-weight映射中性，Sell/Underperform/Underweight映射看空；Not Rated不是中性。无正式评级可依据明确观点给方向，否则 null。
target_price 保存 value(原文目标价数字字符串)、currency(明确币种代码；原文只有$时保留$，不能猜USD)、previous_value(调整前目标价)、horizon(原文目标期限)、implied_upside(报告明确给出的空间百分比，不能自行计算)、valuation_basis(简短中文估值方法和关键倍数)。不得把当前股价或牛熊情景价格当作基准目标价。数字保持原精度、负号、区间，货币和单位分开，不做汇率或单位换算。
forecasts 优先本券商未来2–3个财年的 EPS、净利润、营业收入，最多12条。每条 metric 从 revenue/net_profit/adjusted_net_profit/eps/adjusted_eps/ebitda/ebit/operating_profit/gross_margin/operating_margin/other 选；metric_label 复制原表指标名；period 复制原表头如 FY2027E、12/26E，不擅自改为自然年；value 复制对应数值为字符串；unit、currency、basis(GAAP/non-GAAP等)取原文；source 必须区分 analyst 本券商预测、consensus 市场一致预期、company_guidance 公司指引；previous_value 仅明确给出前值时填写。不能把一致预期或公司指引标成本券商预测，不能省略亏损负号或把百分比当金额。
必须核对预测表脚注：“Based on consensus methodology”仅表示计算口径，不表示数据来自市场一致预期；例如“e = Morgan Stanley Research estimates”对应 analyst，而“§ = Consensus data is provided by Refinitiv Estimates”对应带§的 consensus 行，来源证据要引用对应脚注。表格解析错位而不能可靠确定数值的行应省略，不据此声称原报告没有披露预测。
key_assumptions、catalysts、risks 各最多3条，格式 {text:"简短中文",evidence:[{quote,page}]}，只写原报告明确内容。无值字段 null 或省略；evidence 必须真实，不能用一个与数字无关的摘要证明整张预测表。`;
export const expectationExample={analyst_expectations:[{company:'Example Inc.',ticker:'EX',evidence:[{quote:'Example Inc. (EX)',page:1}],rating:{label:'Buy',stance:'bullish',stance_basis:'rating_mapping',evidence:[{quote:'Rating: Buy. Price target US$25.',page:1}]},target_price:{value:'25',currency:'USD',evidence:[{quote:'Rating: Buy. Price target US$25.',page:1}]},forecasts:[{metric:'eps',metric_label:'EPS',period:'2027E',value:'1.20',unit:null,currency:'USD',source:'analyst',evidence:[{quote:'USD 2026E 2027E',page:2},{quote:'EPS 1.00 1.20',page:2}]}]}]};
