// Third-party distribution advertisements only. Original PDFs/OCR are never written.
export const CLEANUP_VERSION = 'wiki-ads-20260923-v1';
export const SOURCE_BODY_BOUNDARY='<!-- wiki-clean-source-body -->\n';
const flexible = s => [...s].map(c => /[：:]/.test(c) ? '[：:]' : c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[ \\t]*');
const phrases = [
  '防失联请关注微信公众号：爱分享盈策', '防大联请关注微信公众号：爱分享盈策',
  '失联请关注微信公众号：爱分享盈策', '微信公众号：爱分享盈策',
  '获取一手资料请加QQ：390278005', '更多资讯请加QQ：390278005',
  '更多海外投行研报爱分享QQ：390278005', '更多海外投行研报QQ390278005',
  '源头请加qq:390278005', '爱分享QQ：390278005', '加QQ：390278005', 'QQ390278005',
  'ima-【爱分享】的财经资讯', 'ima【爱分享】的财经资讯', '【爱分享】的财经资讯',
  '会员可免费代查全网资料', '会员可免费代具全网资料', '会员可免费代全网资料',
  '知识库里没有收录的研报可免费代查！！！', '购物小助爱分享投研',
  '防失联请关注微信公创众号：爱分享盈策', '公众号：爱分享盈策', '爱分享盈策',
  '购物小助手爱分享投研团队官方唯一知识库', '每月可免费代查5篇',
  '可免费代查全网资料', '爱分享投研团队QQ:390278005', '源头：iam-，qq：390278005',
  '防失联请关注微信公介号，爱分享盈笛',
];
// Whitespace-tolerance is confined to a line; never consume page breaks.
const phrasePatterns = phrases.map(s => new RegExp(flexible(s), 'gi'));
const schedules = new Set([
  '更新时间：','彭博社、路透社新闻：实时更新',
  '财联社：盘中10分钟内更新完成，盘前盘后资料半小时左右更新完成。',
  '红宝书：每日早上7点-8点左右更新','调研纪要：每日早上7点左右更新',
  '大摩闭门会，洪灏：跟随官网更新','外资与内资研报：',
  '早上9点左右更新一次','中午12点左右更新一次','晚上8点左右更新一次',
].map(s=>s.replace(/\s/g,'')));
const marker = /爱分享|390278005|免费代[查具]|Love Sharing/i;
const imagePattern = /!\[[^\]\n]*\]\(([^)\n]+)\)/g;
export const imageKey = url => url.match(/(?:^|\/)([a-f0-9]{64})\.(?:jpe?g|png|webp)(?:[?#].*)?$/i)?.[1]?.toLowerCase() ?? null;
export function imagesIn(text) { return [...text.matchAll(imagePattern)].map(m=>({url:m[1],key:imageKey(m[1])})); }
function cleanLine(line, advertisingPage, trace) {
  if(!marker.test(line) && !(advertisingPage && /更新时间|实时更新|更新完成|左右更新|官网更新|外资与内资研报/.test(line)))return line;
  let out=line;
  let positions=trace?Array.from({length:line.length},(_,i)=>trace.offset+i):null;
  const drop=pattern=>{
    const spans=[];
    out=out.replace(pattern,(match,...args)=>{spans.push([args.at(-2),match.length]);return '';});
    if(positions)for(const [start,length] of spans.reverse()){
      for(const p of positions.splice(start,length))trace.mask[p]=0;
    }
  };
  // Anchored, bounded promotional prefaces end at their own advertised content list.
  drop(/(?:本文由\s*ima\s*-?\s*【爱分享】\s*的财经资讯(?:团队)?收集整理[，,]?\s*)?(?:(?:爱分享)?投研团队(?:每日实时更新|涵盖)|【爱分享】的财经资讯涵盖)[：:]?[ \t]*彭博社[^\n]{0,260}?各大研究所实时分析(?:等)?[\\~～，,]*/gi);
  drop(/本文由\s*ima\s*-?\s*【爱分享】\s*的财经资讯(?:团队)?收集整理[，,]?/gi);
  drop(/团队每满千人就会增加一个新的知识板块[，,]加量不加价[\\~～]*[ \t]*知识库里没有收录的研报可免费代查[！!]*/g);
  drop(/This article was collected and organized by the financial information team of ima \[Love Sharing\][^\n]{0,800}?390278005/gi);
  drop(/Source Love to share qq[ \t]*[：:]?[ \t]*390278005/gi);
  for(const pattern of phrasePatterns)drop(pattern);
  drop(/(?:源头请加|源头请|头源请|头请|请加|请)[a-z0-9]{0,2}[ \t]*[：:][ \t]*390278005/gi);
  drop(/(?:add[ \t]+)?qq[ \t]*[：:][ \t]*390278005/gi);
  drop(/(?<!\d)390278005(?!\d)/g);
  if(advertisingPage) {
    const plain=out.replace(/^\s*#{1,6}\s*/, '').replace(/\s/g,'');
    if(schedules.has(plain)||plain==='390278005')out='';
  }
  if(out!==line && /^[\s#>*_~\\，,：:！!。.-]*$/.test(out))out='';
  if(positions&&!out)for(const p of positions)trace.mask[p]=0;
  return out;
}
export function cleanWikiAds(body, { imageHashes = [], trace = false, unpaged = false } = {}) {
  const knownImages=new Set(imageHashes), removed=[], candidates=[];
  const keep=trace?new Uint8Array(body.length).fill(1):null;
  const paged=/^## PDF 第 \d+ 页\r?$/m.test(body);
  const prefix=!paged&&unpaged?(body.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/)?.[0]??''):'';
  let offset=prefix.length;
  const parts=body.slice(prefix.length).split(/(?=^## PDF 第 \d+ 页\r?$)/m);
  const clean=prefix+parts.map(part=>{
    const base=offset;offset+=part.length;
    const heading=part.match(/^## PDF 第 (\d+) 页\r?\n/);
    // Wiki frontmatter, title, links and generated summaries are outside the PDF body.
    if(!heading&&(paged||!unpaged))return part;
    const page=heading?Number(heading[1]):null, label=heading?.[0]??'', text=part.slice(label.length);
    const adContext=marker.test(text);
    const strongCount=[/本文由\s*ima/,/投研团队/,/390278005/,/免费代[查具]/,/更新时间/].filter(r=>r.test(text)).length;
    let lineOffset=base+label.length;
    let next=text.split(/(?<=\n)/).map(line=>{
      const tail=line.match(/\r?\n$/)?.[0]??'', value=line.slice(0,line.length-tail.length);
      const result=cleanLine(value,adContext&&strongCount>=2,keep?{mask:keep,offset:lineOffset}:null);
      lineOffset+=line.length;
      if(result!==value)removed.push({page,kind:'text',before:value,after:result});
      return result+tail;
    }).join('');
    // Harvest candidates only from pages containing no unrecognized prose at all.
    const remainder=next.replace(imagePattern,'').replace(/[\s#>*_~\\，,：:！!。.-]/g,'');
    if(strongCount>=2&&!remainder&&imagesIn(text).length<=3) {
      candidates.push(...imagesIn(text).filter(i=>i.key).map(i=>({...i,page})));
    }
    const positions=keep?Array.from({length:text.length},(_,i)=>base+label.length+i).filter(p=>keep[p]):null;
    next=next.replace(imagePattern,(whole,url,start)=>{
      const key=imageKey(url);
      if(key&&knownImages.has(key)){if(positions)for(let j=start;j<start+whole.length;j++)keep[positions[j]]=0;removed.push({page,kind:'image',before:whole,after:''});return '';}
      return whole;
    });
    if(next===text)return part;
    if(!next.trim()){if(keep)keep.fill(0,base,base+part.length);if(heading)removed.push({page,kind:'empty_ad_page',before:label,after:''});return '';}
    return label+next.replace(/(?:\r?\n){3,}/g,text.includes('\r\n')?'\r\n\r\n':'\n\n');
  }).join('');
  return {body:clean,changed:clean!==body,removed,candidates,...(keep?{keep}: {})};
}

/** Project exact source deletions through whitespace-normalized, overlapping chunks. */
export function chunkProjector(original, result) {
  if(!result.keep)throw new Error('A traced cleanup is required');
  let text='';const mask=[];
  for(let i=0;i<original.length;i++)if(!/\s/.test(original[i])){text+=original[i];mask.push(result.keep[i]);}
  if([...text].length===0)throw new Error('Empty indexed source');
  let retained='';for(let i=0;i<text.length;i++)if(mask[i])retained+=text[i];
  if(retained!==result.body.replace(/\s/g,''))throw new Error('Cleanup offset validation failed');
  return chunk=>{
    const normalized=chunk.replace(/\s/g,'');
    if(!normalized)return chunk;
    let start=text.indexOf(normalized),expected=null,output=null;
    if(start<0)throw new Error('Indexed chunk is not an exact source span');
    while(start>=0){
      let at=start,projected='';
      for(let i=0;i<chunk.length;i++)if(/\s/.test(chunk[i]))projected+=chunk[i];else if(mask[at++])projected+=chunk[i];
      const comparable=projected.replace(/\s/g,'');
      if(expected!==null&&expected!==comparable)throw new Error('Ambiguous repeated chunk');
      expected=comparable;output=comparable===normalized?chunk:projected.replace(/(?:\r?\n){3,}/g,'\n\n').trim();
      start=text.indexOf(normalized,start+1);
    }
    return output;
  };
}
