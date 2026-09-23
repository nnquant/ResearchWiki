import {createHash} from 'node:crypto';
export const TOPICS=Object.freeze(['Semis','Tech-Hardware','Internet','Software','Telecom-Media','Macro','Rates-Credit','FX','Energy','Metals-Mining','Chemicals-Industrials','Financials','Cross-Asset','Other']);
export function analystId(value){
  const tokens=String(value??'').normalize('NFKC').split(',')[0].replace(/Ph\.\s*D\.?/gi,'').replace(/\b(?:CFA|CPA|CAIA|Jr\.?|MD|AC)\b/gi,'').replaceAll('.','').trim().split(/\s+/).filter(Boolean);
  if(!tokens.length)return 'research';
  let start=tokens.length-1;while(start>1&&/^(?:von|van|der|den|de|da|di|du|del|della|le|la|bin|al|el)$/i.test(tokens[start-1]))start--;
  return [tokens[0],...tokens.slice(Math.max(1,start))].join('-').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9-]/g,'').toLowerCase()||'research';
}
export const chineseTitleSlug=title=>'ZH-'+createHash('sha1').update(String(title).normalize('NFKC')).digest('hex').slice(0,6);
export function setReportKey(naming){
  naming.report_key=`${naming.date}_${naming.broker}_${naming.analyst}_${naming.topic??naming.coverage}_${naming.tickers.join('+')}_${naming.slug}_${naming.pages}p`;
  naming.filename=naming.report_key+'.pdf';return naming;
}
