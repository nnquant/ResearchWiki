import {dictionaryKey,dictionaryMatch,publisherFor,reportDictionaries} from './report-dictionaries.mjs';
import {TOPICS,analystId,chineseTitleSlug,setReportKey} from './report-identity.mjs';
export const NAMING_VERSION='wiki-foreign-naming-v3-20260922';
const clean=s=>String(s??'').normalize('NFKC').replace(/\s+/g,' ').trim();
const letters=s=>clean(s).toLowerCase().replace(/[^a-z0-9]/g,'');
const ascii=s=>clean(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9]+/g,'-').replace(/^-|-$/g,'');
export const validNamingDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s??'')&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const monthNames=['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
const headerMaps=new WeakMap();
function headerDictionary(dict){let index=headerMaps.get(dict);if(index)return index;index={pairs:new Map(),sectors:new Map()};for(const sector of dict.sectors)for(const alias of sector.aliases){index.sectors.set(dictionaryKey(alias),sector);for(const region of dict.regions)for(const ra of region.aliases){const key=dictionaryKey(ra+' '+alias),pairs=index.pairs.get(key)??[];if(!pairs.some(p=>p.region===region&&p.sector===sector))pairs.push({region,sector});index.pairs.set(key,pairs);}}headerMaps.set(dict,index);return index;}
function explicitDate(s){
  let m=s.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/),d;
  if(m)d=`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  else {m=s.match(/\b(\d{1,2})\s+([A-Za-z]{3,9})\.?[,]?\s+(20\d{2})\b/);if(m){const month=monthNames.indexOf(m[2].slice(0,3).toLowerCase())+1;if(month)d=`${m[3]}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;}
    else{m=s.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})[,]?\s+(20\d{2})\b/);if(m){const month=monthNames.indexOf(m[1].slice(0,3).toLowerCase())+1;if(month)d=`${m[3]}-${String(month).padStart(2,'0')}-${m[2].padStart(2,'0')}`;}}}
  return validNamingDate(d)?d:null;
}
export function reportDate(pdf,record,front,titleVerified=false){
  const pages=pdf.sample_pages??[],all=pages.map(p=>p.text).join('\n');
  const upload=String(record.source_meta?.file_create_time??record.source_meta?.upload_date??'').slice(0,10);
  const checked=(date,source,precision,evidence,extra={})=>{
    if(validNamingDate(upload)&&Date.parse(date)>Date.parse(upload)+86400000)return {invalid:true,reason:'publication-after-upload',date,upload_date:upload};
    return {date,date_source:source,date_precision:'day',date_evidence:evidence,upload_date:validNamingDate(upload)?upload:null,upload_lag_review:validNamingDate(upload)&&(Date.parse(upload)-Date.parse(date)>30*86400000),...extra};
  };
  for(const match of all.matchAll(/First Published\s*:?\s*([^\n]{0,90})/gi)){
    const line=match[1],date=explicitDate(line),time=line.match(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(?:UTC|GMT)\b/i);
    if(date&&time)return checked(date,'first_published_utc','exact',clean(match[0]),{first_published_utc:`${date}T${time[1].padStart(2,'0')}:${time[2]}:${time[3]??'00'}Z`});
  }
  const ordered=[...new Set([...[...(front.lines??[])].sort((a,b)=>a.y-b.y||a.x-b.x).map(l=>l.text),...front.text.split('\n')])];
  for(const line of ordered.map(clean)){
    const date=explicitDate(line);if(!date)continue;
    const rest=line.replace(/\b20\d{2}[-/.]\d{1,2}[-/.]\d{1,2}\b|\b\d{1,2}\s+[A-Za-z]{3,9}\.?[,]?\s+20\d{2}\b|\b[A-Za-z]{3,9}\.?\s+\d{1,2}[,]?\s+20\d{2}\b/,'').replace(/\b\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?/gi,'').replace(/\b(?:ET|EST|EDT|GMT|UTC|BST|HKT|SGT|JST|KST|CET|CEST|BRT|IST|AEST|AEDT|PT|PST|PDT|date|published|publication date|report date)\b|\b\d+\s+pages?\b/gi,'').replace(/[\s|│,.;:\-–—/]/g,'');
    if(!rest)return checked(date,'report_header','exact',line);
  }
  const wiki=String(record.title??'').match(/^\s*(20\d{2})(\d{2})(\d{2})/);
  if(wiki&&titleVerified){const date=`${wiki[1]}-${wiki[2]}-${wiki[3]}`;if(validNamingDate(date))return checked(date,'wiki_title','exact_external',record.title);}
  const m=pdf.metadata?.creationDate?.match(/^D:(20\d{2})(\d{2})(\d{2})/);
  if(m&&validNamingDate(upload)){
    const date=`${m[1]}-${m[2]}-${m[3]}`,month=front.text.match(/(?:^|\n)\s*([A-Za-z]{3,9})\s+(20\d{2})\s*(?:\n|$)/);
    if(month&&validNamingDate(date)&&month[2]===m[1]&&monthNames.indexOf(month[1].slice(0,3).toLowerCase())+1===Number(m[2])&&Date.parse(date)>=Date.parse(upload)-7*86400000&&Date.parse(date)<=Date.parse(upload))return checked(date,'pdf_creation_date_same_month','inferred_day',pdf.metadata.creationDate);
  }
  return null;
}
const headerNoise=/^(?:abc|M|Q|Idea|Insight|Update|First Read|Global Research|Equity Research|Research|Equities|Deutsche Bank|Barclays|J\.?P\.? Morgan|Goldman Sachs|Morgan Stanley|Nomura|Citi|Bernstein|BUY|SELL|HOLD|OUTPERFORM|UNDERPERFORM|NEUTRAL|OVERWEIGHT|EQUAL.WEIGHT|Stock Rating|Price Target|Price Snapshot|Key Data|Key Takeaways|GS Forecast|Asia Pacific|North America|Europe|Japan|China \(PRC\))$/i;
function originalTitle(pdf,front){
  const meta=clean(pdf.metadata?.title);
  const metadataTitle=meta.length>=15&&/[A-Za-z]{4}/.test(meta)&&!/[\u3400-\u9fff]/.test(meta)&&letters(front.text).includes(letters(meta))?{title:meta,title_source:'pdf-title-verified'}:null;
  const lines=front.lines.filter(l=>l.size>=12&&l.y>=0&&l.y<500&&/[A-Za-z]{3}/.test(l.text)&&!/[\u3400-\u9fff]/.test(l.text)&&!headerNoise.test(clean(l.text))&&!/^(?:\d{1,2}\s+\w+\s+20\d\d|\w+\s+\d{1,2},?\s+20\d\d)$/.test(clean(l.text))&&!/^(?:China \(PRC\)|Japan|Europe|North America)\s*\|/.test(l.text));
  if(!lines.length)return metadataTitle;
  const largest=Math.max(...lines.map(l=>l.size)),anchor=lines.filter(l=>l.size>=largest-0.5).sort((a,b)=>a.y-b.y||a.x-b.x)[0];
  if(largest<15)return metadataTitle;
  const rows=lines.filter(l=>l.y>=anchor.y-32&&l.y<=anchor.y+110&&Math.abs(l.x-anchor.x)<55&&l.size>=Math.min(13,largest*.65)).sort((a,b)=>a.y-b.y||a.x-b.x);
  let selected=[],last=null;
  for(const line of rows){if(last&&line.y-last.y>52)break;selected.push(line);last=line;}
  if(!selected.includes(anchor))selected=[anchor];
  const title=clean(selected.map(l=>l.text.replace(/\s*[|│]\s*(?:North America|Asia Pacific|Europe|Japan|China \(PRC\))\s*$/i,'')).join(' '));
  if(title.length<12||title.length>500||/^(?:IMPORTANT|DISCLOSURE|Disclaimer|Contents|Table of Contents|Key Data)/i.test(title))return metadataTitle;
  return {title,title_source:'pdf-heading',title_page:front.page};
}
export function withParsedNamingFallback(pdf,body){
  if(!body)return pdf;
  const pages=[...body.replace(/\r\n/g,'\n').matchAll(/^## PDF 第 (\d+) 页\n([\s\S]*?)(?=^## PDF 第 \d+ 页|$(?![\s\S]))/gm)].filter(m=>Number(m[1])<=4).map(m=>({page:Number(m[1]),text:m[2],lines:m[2].split('\n').flatMap((s,i)=>/^#{1,3}\s/.test(s)?[{text:s.replace(/^#+\s*/,''),size:18,x:0,y:i*3}]:[]),ocr:true}));
  return {...pdf,ocr_pages:pages};
}
export function authorCandidates(front,record){
  const txt=front.text,lines=txt.split('\n').map(clean).filter(Boolean),candidates=[];
  const strip=s=>clean(s).split(/[|│]/)[0].replace(/^(?:By|Authors?|Analysts?)\s*:?\s+/i,'').replace(/\s*[-–]\s*N[A-Z]{2,6}\s*$/,'').replace(/(?<=[a-z])AC\b/,'').replace(/[, ]+(?:CFA|AC|Ph\.?D\.?|CPA|MD|ACA|CA)(?:[, ]+.*)?$/i,'').replace(/[*>]+$/,'').trim();
  const eligible=s=>/^[A-ZÀ-ž][A-Za-zÀ-ž.'’ -]+$/.test(s)&&s.split(/\s+/).length>=2&&s.split(/\s+/).length<=5&&!/research|analyst|associate|securities|equity|global|bank|strategy|morgan|sachs|disclosure|president|director|limited|university|investment|capital|markets|hong kong|north america|united states/i.test(s);
  for(let i=0;i<lines.length;i++)if(/@[A-Za-z0-9.-]+\.[a-z]{2}/i.test(lines[i])){
    const email=lines[i].match(/[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/i)?.[0];if(!email)continue;
    const local=letters(email.split('@')[0]);
    for(let j=Math.max(0,i-4);j<=Math.min(lines.length-1,i+2);j++){
      const name=strip(lines[j]);if(!eligible(name))continue;
      const surname=name.split(/\s+/).at(-1);if(surname.length<2||!local.includes(letters(surname))||(surname.length===2&&!email.split('@')[0].toLowerCase().split(/[._-]/).includes(letters(surname))))continue;
      candidates.push({name,raw:lines[j],email,position:j,page:front.page});break;
    }
  }
  for(const raw of record.article_metadata?.authors??record.authors??[]){const name=strip(raw);if(!eligible(name)||!letters(txt).includes(letters(name)))continue;if(!candidates.some(c=>letters(c.name)===letters(name)))candidates.push({name,raw,page:front.page,position:lines.findIndex(s=>letters(s).includes(letters(name)))});}
  for(const candidate of candidates){const visual=front.lines?.find(l=>dictionaryKey(strip(l.text))===dictionaryKey(candidate.name));candidate.visual_y=visual?.y??Infinity;candidate.visual_x=visual?.x??Infinity;}
  return candidates.sort((a,b)=>Number.isFinite(a.visual_y)&&Number.isFinite(b.visual_y)?(Math.abs(a.visual_y-b.visual_y)>3?a.visual_y-b.visual_y:a.visual_x-b.visual_x):Number.isFinite(a.visual_y)?-1:Number.isFinite(b.visual_y)?1:a.position-b.position);
}
function containsAlias(text,alias){if(/[^\x00-\x7f]/.test(alias))return text.includes(alias);const escaped=alias.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return new RegExp('(?:^|[^a-z0-9])'+escaped+'(?:$|[^a-z0-9])','i').test(text);}
const brokerRegexCache=new WeakMap();
export function brokerCheck(pdf,selected,dict=reportDictionaries){
  const text=(pdf.sample_pages??[]).filter(p=>p.page<=3).map(p=>p.text).join('\n');
  if(text.replace(/\s/g,'').length<80)return {status:'unchecked'};
  let patterns=brokerRegexCache.get(dict);if(!patterns){patterns=dict.institutions.map(b=>({broker:b.id,regex:new RegExp((b.body_patterns??[]).map(p=>'(?:'+p+')').join('|')||'(?!)','gi')}));brokerRegexCache.set(dict,patterns);}
  const counts=patterns.map(p=>({broker:p.broker,count:[...text.matchAll(p.regex)].length})).filter(p=>p.count).sort((a,b)=>b.count-a.count);
  if(!counts.length)return {status:'unchecked'};
  const tied=counts.filter(p=>p.count===counts[0].count).map(p=>p.broker);
  return {status:tied.includes(selected)?'matched':tied.length>1?'ambiguous':'mismatch',detected:tied,counts:counts.slice(0,5)};
}
function verifiedWikiTitle(record,front){
  const raw=String(record.title??record.filename??'').normalize('NFKC').replace(/\.pdf$/i,'');
  const tail=raw.split(/[\u3400-\u9fff]/).at(-1)?.trim().replace(/^[^A-Za-z]+/,'');
  if(tail&&tail.length>=15&&!/(?:\.\.\.|…|&)\s*$/.test(tail)){
    // Token boundaries reject downloaded titles cut in the middle of a word.
    // Ignore explicit ticker decorations, which often differ from the PDF RIC.
    const tokens=s=>clean(s).replace(/\([A-Z0-9][A-Z0-9.]{0,14}(?:\s+[A-Z]{2})?\)/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    if((' '+tokens(front.text)+' ').includes(' '+tokens(tail)+' '))return {title:tail,title_source:'wiki-title-verified',title_page:front.page};
  }
  return null;
}
export function buildForeignName(record,pdf,{dict=reportDictionaries,mtime,override}={}){
  const explicitPublisher=publisherFor(record,{dict});
  if(explicitPublisher?.foreign===false||record.source_meta?.report_category==='内资'||/(?:^|\/)reports\/raw1\//i.test(String(record.source_meta?.import_path??'').replaceAll('\\','/')))return {status:'excluded',reason:'domestic-institution',broker:explicitPublisher?.id};
  if(pdf.error)return {status:'review',reason:'pdf-unreadable',error:pdf.error};
  let front=pdf.sample_pages?.find(p=>p.page<=4&&(p.text.match(/[A-Za-z]/g)?.length??0)>200&&!/本文由ima/.test(p.text));
  if(!front)front=pdf.ocr_pages?.find(p=>(p.text.match(/[A-Za-z]/g)?.length??0)>200&&!/本文由ima/.test(p.text));
  if(!front)return {status:'review',reason:'needs-text-or-ocr'};
  for(const issuer of front.text.matchAll(/Issuer of report\s*:\s*([^\n]+)/gi)){
    const declared=dictionaryMatch('institutions',clean(issuer[1]),{dict});
    if(declared?.foreign===false)return {status:'excluded',reason:'domestic-issuer',broker:declared.id,issuer_evidence:issuer[0]};
  }
  let broker=explicitPublisher;
  if(!broker){const domains=[...new Set([...front.text.matchAll(/@[A-Za-z0-9.-]+/g)].map(m=>m[0].slice(1).toLowerCase()))];const matches=dict.institutions.filter(b=>b.domains?.some(d=>domains.includes(d)));if(matches.length===1)broker={...matches[0],match_source:'author-email-domain'};}
  if(broker?.foreign===false)return {status:'excluded',reason:'domestic-institution',broker:broker.id};
  if(!broker)return {status:'review',reason:'publisher-not-in-dictionary'};
  const brokerAudit=brokerCheck(pdf,broker.id,dict);
  if(brokerAudit.status==='mismatch')return {status:'review',reason:'publisher-body-mismatch',broker:broker.id,broker_check:brokerAudit};
  const fallback=[],heading=originalTitle(pdf,front),verified=verifiedWikiTitle(record,front);
  const extended=verified&&heading&&letters(heading.title).startsWith(letters(verified.title))&&letters(heading.title).length>letters(verified.title).length+3;
  const wikiTitle=extended?null:verified;let candidate=wikiTitle??heading;
  if(!candidate){const ocr=pdf.ocr_pages?.find(p=>p.page===front.page);if(ocr)candidate=originalTitle(pdf,ocr);}
  // Never hash a translated download filename: Chinese fallback requires a
  // verbatim original title supplied with explicit report evidence.
  if(!candidate&&record.title_orig&&record.title_orig_source==='report-header'&&clean(front.text).includes(clean(record.title_orig)))candidate={title:record.title_orig,title_orig:record.title_orig,title_source:'report-header-chinese'};
  const date=reportDate(pdf,record,front,!!verified);
  if(!candidate)return {status:'review',reason:'english-title-unresolved',broker:broker.id};
  if(!date)return {status:'review',reason:'full-date-unresolved',broker:broker.id};
  if(date.invalid)return {status:'review',...date,broker:broker.id};
  const authors=authorCandidates(front,record);let analyst='research',author=null,authorSource='institution-research';
  if(!authors.length&&/[a-z]+[._-][a-z]+@[a-z0-9.-]+\.[a-z]+/i.test(front.text)&&!dict.institutional_authors.some(a=>a.id==='global-institute'&&a.aliases.some(alias=>front.text.includes(alias))))return {status:'review',reason:'personal-author-unresolved',broker:broker.id};
  if(authors.length){const first=authors[0],matched=dictionaryMatch('authors',first.name,{institution:broker.id,dict})??dictionaryMatch('authors',first.raw,{institution:broker.id,dict});author=matched?.name??first.name;analyst=matched?.analyst_id??analystId(author);authorSource=matched?'dictionary':'source-fallback';if(!matched)fallback.push({field:'author',value:first.name,evidence:first});}
  else{const unit=dict.institutional_authors.find(a=>a.aliases.some(alias=>front.text.includes(alias)));if(unit)analyst=unit.id;else fallback.push({field:'author',value:'research',reason:'no-personal-author-identified'});}
  const meta=record.article_metadata??record;
  const regionHits=dict.regions.filter(r=>r.aliases.some(a=>containsAlias(candidate.title.split(/[:|]/)[0],a)));
  let region=regionHits.length===1?regionHits[0]:null;
  if(!region){const matches=[...new Set((meta.markets??[]).map(v=>dictionaryMatch('regions',v,{dict})?.id).filter(Boolean))];if(matches.length===1)region=dict.regions.find(r=>r.id===matches[0]);}
  const titleSector=dict.sectors.flatMap(r=>r.aliases.filter(a=>containsAlias(candidate.title,a)).map(a=>({row:r,position:candidate.title.toLowerCase().indexOf(a.toLowerCase()),length:a.length}))).sort((a,b)=>a.position-b.position||b.length-a.length)[0]?.row;
  const sectors=[...new Set((meta.industries??[]).map(v=>dictionaryMatch('sectors',v,{dict})?.id).filter(Boolean))];
  const headerLines=front.lines.filter(l=>l.y<500&&clean(l.text).length<65);
  const headers=headerDictionary(dict),headerPairs=headerLines.flatMap(l=>headers.pairs.get(dictionaryKey(l.text))??[]);
  if(!region&&new Set(headerPairs.map(p=>p.region.id)).size===1)region=headerPairs[0].region;
  const headerSector=headerPairs[0]?.sector??headerLines.map(l=>headers.sectors.get(dictionaryKey(clean(l.text).replace(/^(?:Sector|Industry|Industries|Coverage)\s*[:|]\s*/i,'')))).find(Boolean);
  const sector=headerSector??titleSector??(sectors.length===1?dict.sectors.find(r=>r.id===sectors[0]):null);
  const coverage=sector?.id??'Unknown';
  if(!sector)fallback.push({field:'coverage',value:coverage,reason:'no-unambiguous-dictionary-sector'});
  const normalizeTicker=(token,exchange)=>{let t=token.toUpperCase();const e=exchange?.toUpperCase();if(e&&e!=='US'&&e!=='CH'&&!t.includes('.'))t+='.'+e;if(/\.SH$/.test(t))t=t.replace(/\.SH$/,'.SS');return t.replace(/\.US$/,'');};
  const ticks=[...candidate.title.normalize('NFKC').matchAll(/\(([A-Z0-9][A-Z0-9.]{0,14})(?:\s+(US|CH|HK|JP|KS|TW))?\)/g)].map(m=>normalizeTicker(m[1],m[2]));
  if(!ticks.length){for(const m of String(record.title??record.filename).normalize('NFKC').matchAll(/\(([A-Z0-9][A-Z0-9.]{0,14})\)/g))if(letters(front.text).includes(letters(m[1])))ticks.push(m[1]);}
  const uniqueTicks=[...new Set(ticks.map(t=>t.replace(/\.US$/,'')))].filter(t=>!['CFA','ESG','AI','EPS','ADR','REIT','USD','JPY','RMB','US','CH','HK','JP'].includes(t));
  const tickers=uniqueTicks.filter(t=>t.includes('.')||!uniqueTicks.some(other=>other.startsWith(t+'.')));
  let title=candidate.title.replace(/\([A-Z0-9][A-Z0-9.]{0,14}(?:\s+(?:US|CH|HK|JP|KS|TW))?(?:\s*[/,]\s*[A-Z0-9.]+(?:\s+[A-Z]{2})?)*\)/g,'');
  let slug=candidate.title_orig?chineseTitleSlug(candidate.title_orig):ascii(title).slice(0,90).replace(/-$/,'');
  if(!slug)return {status:'review',reason:'title-invalid'};
  const normalizedAuthors=authors.map(a=>dictionaryMatch('authors',a.name,{institution:broker.id,dict})?.name??a.name);
  const result={status:'ready',version:NAMING_VERSION,dictionary_version:dict.version,...date,broker:broker.id,broker_source:broker.match_source,broker_check:brokerCheck(pdf,broker.id,dict),analyst,author,author_source:authorSource,authors:normalizedAuthors,author_relations:normalizedAuthors.map((name,i)=>({analyst_id:analystId(name),analyst_key:analystId(name)+'@'+broker.id,name,role:i===0?'lead':'team-member'})),coverage,topic:coverage,region:region?.id??null,sector_source:headerSector?'header_dictionary':titleSector?'title_judgment':sector?'metadata_dictionary':'missing',sector_precision:headerSector?'exact':sector?'judged':'unknown: no unambiguous topic evidence',tickers:tickers.length>0&&tickers.length<=4?tickers:['SECTOR'],...candidate,slug,pages:Number.isInteger(pdf.pages)&&pdf.pages>=0?pdf.pages:0,fallback};
  if(override){if(!override.source)throw new Error('命名人工覆盖必须附来源');Object.assign(result,override,{override_source:override.source});}
  setReportKey(result);
  validateForeignFilename(result.filename);return result;
}
export function validateForeignFilename(name){
  if(!/^[\x20-\x7e]+$/.test(name)||!name.endsWith('.pdf')||name.length>240)throw new Error('文件名必须为 ASCII PDF 且不超过 240 字符');
  const p=name.slice(0,-4).split('_');
  if(p.length!==7||!validNamingDate(p[0])||!reportDictionaries.institutions.some(b=>b.foreign&&b.id===p[1])||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(p[2])||![...TOPICS,'Unknown'].includes(p[3])||!/^[A-Z0-9.]+(?:\+[A-Z0-9.]+){0,3}$/.test(p[4])||!/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/.test(p[5])||p[5].length>90||!/^\d+p$/.test(p[6]))throw new Error('文件名不符合 v3 七段命名规则：'+name);
  return true;
}
