import fs from 'node:fs/promises';
import path from 'node:path';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { JSDOM } from 'jsdom';
import { Defuddle } from 'defuddle/node';
import matter from 'gray-matter';
import { root,repo,config,dataPath,sha,now,safeName,atomicJson,readJson,manifest,manifestPath,run,runtimeEnv,gb,assetUrl,filesBelow,slash } from './common.mjs';
import { ima,findKnowledgeBase,listKnowledge } from './ima.mjs';
import { normalizeArticleMetadata } from './article-metadata.mjs';
import { withEntityTags } from './article-entities.mjs';
import {isCompanyReport} from './analyst-expectations.mjs';
import { readPage, writePage, invalidateScan } from './server/wiki-files.mjs';
import { sharedConnection, createSharedClient } from './shared-api-client.mjs';

export function isPrivateIp(ip) {
  if(ip.includes(':')) {
    const v=ip.toLowerCase();
    if(v.startsWith('::ffff:'))return isPrivateIp(v.slice(7));
    return v==='::1'||v==='::'||v.startsWith('fc')||v.startsWith('fd')||v.startsWith('fe80:');
  }
  const [a,b]=ip.split('.').map(Number);
  return a===0||a===10||a===127||a>=224||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===100&&b>=64&&b<=127);
}
export async function validateUrl(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('只接受不带凭证的 HTTP(S) 来源链接');
  const hostname=url.hostname.replace(/^\[|\]$/g,'');
  if(hostname==='localhost'||hostname.endsWith('.localhost'))throw new Error('来源链接不能访问本机或内网');
  const ips=isIP(hostname)?[{address:hostname}]:await lookup(hostname,{all:true});
  if(!ips.length||ips.some(x=>isPrivateIp(x.address)))throw new Error('来源链接不能访问本机或内网');
  return url;
}
export async function download(urlValue, headers={}, maxBytes=100*1024*1024) {
  let url=await validateUrl(urlValue);const initialOrigin=url.origin;
  for(let attempt=0;attempt<6;attempt++) {
    const response=await fetch(url,{headers:{'user-agent':'Mozilla/5.0 QuantResearchWiki/0.1',...(url.origin===initialOrigin?headers:{})},redirect:'manual',signal:AbortSignal.timeout(120000)});
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();url=await validateUrl(new URL(response.headers.get('location'),url));continue;
    }
    if(!response.ok)throw new Error(`原文下载失败：HTTP ${response.status}（${url.hostname}），请使用原站或 IMA 客户端查看原文`);
    if(Number(response.headers.get('content-length')||0)>maxBytes)throw new Error('文件超过 100MB 限制');
    const parts=[];let size=0;
    for await(const part of response.body) {
      size+=part.length;if(size>maxBytes)throw new Error('文件超过 100MB 限制');parts.push(part);
    }
    return {bytes:Buffer.concat(parts),type:response.headers.get('content-type')||'',url:url.href};
  }
  throw new Error('来源链接重定向次数过多');
}
export function cleanUrl(value) {
  const url=new URL(value);url.hash='';
  for(const key of [...url.searchParams.keys()])if(key.startsWith('utm_')||['fbclid','gclid'].includes(key))url.searchParams.delete(key);
  return url.href;
}
export async function extractHtml(bytes,url) {
  let html=bytes.toString('utf8');
  const charset=html.slice(0,4096).match(/charset\s*=\s*["']?([\w-]+)/i)?.[1];
  if(charset&&!/^utf-?8$/i.test(charset))html=new TextDecoder(charset).decode(bytes);
  const dom=new JSDOM(html,{url}); // Scripts and subresource loading remain disabled.
  const doc=dom.window.document;
  const wechat=new URL(url).hostname==='mp.weixin.qq.com';
  const isX=/(^|\.)(x.com|twitter.com)$/.test(new URL(url).hostname);
  if(isX&&!doc.querySelector('article,[data-testid="tweetText"],[data-testid="twitterArticleReadView"]')) {
    dom.window.close();
    throw new Error('X 未提供可读取的文章正文，请从已登录页面保存正文 HTML/Markdown 后导入');
  }
  if(wechat) {
    const content=doc.querySelector('#js_content');
    if(!content){dom.window.close();throw new Error('微信正文不可读取（可能需要验证或已删除），请保存可读页面为 HTML 后导入');}
    content.removeAttribute('style');
    for(const img of content.querySelectorAll('img[data-src]'))img.setAttribute('src',img.getAttribute('data-src'));
  }
  const result=await Defuddle(doc,url,{markdown:true,useAsync:false,removeHiddenElements:!wechat});
  const text=(result.contentMarkdown||result.content||'').trim();
  if(text.length<120||/^(?:just a moment|access denied|enable javascript|javascript is not available)/i.test(text))throw new Error('未提取到完整正文；如 X 或微信要求登录，请保存已打开的正文 HTML/Markdown 后导入');
  dom.window.close();
  return {text,title:result.title||new URL(url).hostname,author:result.author||'',published_at:result.published||null};
}
let recordWrites=Promise.resolve(),articleReads=Promise.resolve();
async function saveRecord(record) {
  const snapshot=structuredClone(record);
  const write=recordWrites.then(async()=>{const m=await manifest();m.documents[snapshot.id]=snapshot;m.updated_at=now();await atomicJson(manifestPath,m);});
  recordWrites=write.catch(()=>{});return write;
}
async function readArticle(record,body) {
  const read=articleReads.then(async()=>{const {analyzeArticle}=await import('./article-llm.mjs');return analyzeArticle(record,body,{requireEntities:true,requireExpectations:isCompanyReport(record)});});
  articleReads=read.catch(()=>{});return read;
}
export async function capture({bytes,filename,title,source_kind='local',source_url=null,source_key,source_meta={},media_type,metadata={}}) {
  metadata=normalizeArticleMetadata(metadata);
  const hash=sha(bytes);const id=sha(source_key||`sha256:${hash}`).slice(0,24);
  const m=await manifest(),old=m.documents[id];
  if(old?.sha256===hash&&['parsed','indexed'].includes(old.status))return {...(Object.keys(metadata).length?await updateArticleMetadata(old.id,metadata):old),duplicate:true};
  const revision=hash.slice(0,16),folder=dataPath('raw',id,revision);
  await fs.mkdir(folder,{recursive:true});
  filename=safeName(filename);
  const raw=path.join(folder,filename);
  try {await fs.writeFile(raw,bytes,{flag:'wx'});} catch(e) {if(e.code!=='EEXIST')throw e;if(sha(await fs.readFile(raw))!==hash)throw new Error('原件哈希不一致');}
  const record={id,title:title||filename.replace(/\.[^.]+$/,''),source_kind,source_url,source_meta,media_type,
    sha256:hash,revision,filename,raw_path:slash(path.relative(root,raw)),received_at:old?.received_at||now(),updated_at:now(),
    document_type:old?.document_type||null,
    article_metadata:normalizeArticleMetadata({...old?.article_metadata,...metadata}),
    status:'captured',history:old&&old.sha256!==hash?[...(old.history||[]),{revision:old.revision,sha256:old.sha256,parsed_path:old.parsed_path,updated_at:old.updated_at}]:old?.history||[]};
  await saveRecord(record);await atomicJson(path.join(folder,'provenance.json'),record);return record;
}
export async function parseRecord(record,{mineruVramGB,skipArticleAnalysis=false}={}) {
  if(record.duplicate)return record;
  const out=dataPath('parsed',record.id,record.revision);await fs.mkdir(out,{recursive:true});
  record.status='parsing';await saveRecord(record);
  try {
    const raw=dataPath(record.raw_path),bytes=await fs.readFile(raw);let md,body,details={};
    if(bytes.subarray(0,5).toString()==='%PDF-') {
      const command=dataPath('runtime','mineru','Scripts','python.exe');
      const parsedAlready=record.parser==='MinerU'&&record.parsed_path&&await fs.access(dataPath(record.parsed_path)).then(()=>true,()=>false);
      if(!parsedAlready) {
        const shared = sharedConnection(config, root);
        if (shared) {
          const remote = await createSharedClient(shared).parsePdf(bytes, out);
          record.remote_parser = { baseUrl: remote.baseUrl, job_id: remote.id };
        } else await run(command,[path.join(repo,'scripts','parse_pdf.py'),raw,out,'--backend',config.mineruBackend,'--device',config.mineruDevice],{env:{...runtimeEnv(),...(mineruVramGB?{MINERU_VIRTUAL_VRAM_SIZE:String(mineruVramGB)}:{})},timeout:3600000,logFile:dataPath('logs',`mineru-${record.id}.log`)});
      }
      const candidates=(await filesBelow(out)).filter(x=>x.endsWith('.md')&&!x.endsWith(`${path.sep}pages.md`));
      if(candidates.length!==1)throw new Error(`MinerU 应输出一份 Markdown，实际 ${candidates.length} 份`);
      md=candidates[0];body=await fs.readFile(path.join(path.dirname(md),'pages.md'),'utf8');
      record.paged_path=slash(path.relative(root,path.join(path.dirname(md),'pages.md')));
      const contentFiles=(await filesBelow(out)).filter(x=>x.endsWith('_content_list.json'));
      if(contentFiles.length) {
        const items=JSON.parse(await fs.readFile(contentFiles[0],'utf8'));
        const pages=[...new Set(items.map(x=>x.page_idx).filter(Number.isInteger))].sort((a,b)=>a-b);
        const pageMap=items.map((x,i)=>({block:i,page:(x.page_idx??0)+1,type:x.type,bbox:x.bbox||null,text:(x.text||x.table_caption?.join(' ')||x.image_caption?.join(' ')||'').slice(0,500),image:x.img_path||null}));
        await atomicJson(path.join(out,'page-map.json'),pageMap);
        const report=JSON.parse(await fs.readFile(path.join(out,'parse-report.json'),'utf8'));
        details={pages:report.pdf_pages,pages_with_content:pages.length,page_map:slash(path.relative(root,path.join(out,'page-map.json'))),blocks:items.length};
      }
      record.parser='MinerU';
    } else if(/\.(html?|mhtml)$/i.test(record.filename)||[2,6].includes(record.media_type)) {
      const parsed=await extractHtml(bytes,record.source_url||'https://local-import.invalid/article');
      body=parsed.text;details={author:parsed.author,published_at:parsed.published_at};record.title=parsed.title||record.title;
      md=path.join(out,'article.md');await fs.writeFile(md,body,'utf8');record.parser='Defuddle';
    } else if(/\.(md|txt)$/i.test(record.filename)) {
      body=new TextDecoder('utf-8',{fatal:true}).decode(bytes);md=path.join(out,'article.md');await fs.writeFile(md,body,'utf8');record.parser=record.source_kind==='ima'?'IMA note plaintext':'Markdown';
    } else throw new Error('仅支持 PDF、HTML、Markdown、TXT');
    if(body.trim().length<80)throw new Error('正文过短，保留原件并标记解析失败');
    record={...record,...details,parsed_path:slash(path.relative(root,md)),characters:body.length,status:'parsed',updated_at:now(),error:null,wiki_slug:`sources/${record.id}`};
    await saveRecord({...record,status:'processing'});
    const analysis=skipArticleAnalysis?null:await readArticle(record,body);
    if(analysis) {
      const explicitTags=Object.hasOwn(record.article_metadata||{},'tags');
      record.article_metadata={...analysis.metadata,...record.article_metadata};
      if(!explicitTags)record.article_metadata.tags=[...new Set([record.source_kind,record.article_metadata.document_type??record.document_type,...(record.article_metadata.tags||[])].filter(Boolean))];
    record.llm={status:'complete',mode:analysis.mode,model:analysis.model,completed_at:analysis.completed_at,segments:analysis.segments,report_path:analysis.report_path,input_sha256:analysis.input_sha256,...(analysis.entity_version?{entity_version:analysis.entity_version,entity_report_path:analysis.report_path,entity_completed_at:analysis.completed_at}:{}),...(analysis.expectations_version?{expectations_version:analysis.expectations_version,expectations_report_path:analysis.report_path,expectations_completed_at:analysis.completed_at}:{})};
      record.document_type=record.article_metadata.document_type??record.document_type;
    }
    // Rewrite only relative assets; parsed Markdown and source bytes remain untouched.
    const resolveAsset=target=>/^(https?:|data:|\/|#)/i.test(target)?target:assetUrl(path.resolve(path.dirname(md),target));
    body=body.replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,target)=>`![${alt}](${resolveAsset(target)})`)
      .replace(/(<img\b[^>]*\bsrc=["'])([^"']+)(["'])/gi,(_,a,target,c)=>a+resolveAsset(target)+c);
    const fm={title:record.title,type:'source',source_kind:record.source_kind,source_url:record.source_url,
      received_at:record.received_at,published_at:record.published_at||null,sha256:record.sha256,parser:record.parser,
      raw_path:record.raw_path,parsed_path:record.parsed_path,review_status:'unread',document_type:record.document_type||null,
      tags:[record.source_kind,record.document_type||({wechat:'公众号文章',x:'X 文章',web:'网页'}[record.source_kind])||'待分类'],
      ...(record.author?{authors:[record.author]}:{}),...record.article_metadata};
    if(fm.document_type && !Object.hasOwn(record.article_metadata||{},'tags'))fm.tags=[record.source_kind,fm.document_type];
    fm.tags=withEntityTags(fm).tags;
    const header='---\n'+Object.entries(fm).map(([k,v])=>`${k}: ${JSON.stringify(v)}`).join('\n')+'\n---\n';
    const provenance=`# ${record.title}\n\n> 文献全文。接收时间：${record.received_at}；发布日期：${record.published_at||'待核实'}。\n\n[原始文件](${assetUrl(raw)}) · [解析 Markdown](${assetUrl(md)})${record.page_map?` · [页码与内容块](${assetUrl(dataPath(record.page_map))})`:''}\n\n---\n\n`;
    await fs.writeFile(dataPath('wiki',record.wiki_slug+'.md'),header+provenance+body,'utf8');
    invalidateScan();
    await saveRecord(record);return record;
  } catch(e) {record.status='failed';record.error=e.message;record.updated_at=now();await saveRecord(record);throw e;}
}
export async function ingestFile(file,options={}) {
  const bytes=await fs.readFile(file);
  return parseRecord(await capture({bytes,filename:path.basename(file),...options}));
}
export async function ingestUrl(value,{metadata={}}={}) {
  metadata=normalizeArticleMetadata(metadata);
  const url=cleanUrl(value),m=await manifest(),id=sha(url).slice(0,24);
  if(['indexed','parsed'].includes(m.documents[id]?.status))return {...(Object.keys(metadata).length?await updateArticleMetadata(id,metadata):m.documents[id]),duplicate:true};
  const result=await download(url);
  const isPdf=result.bytes.subarray(0,5).toString()==='%PDF-';
  const host=new URL(url).hostname,kind=host==='mp.weixin.qq.com'?'wechat':/(^|\.)(x.com|twitter.com)$/.test(host)?'x':'web';
  const filename=isPdf?safeName(decodeURIComponent(new URL(url).pathname.split('/').pop()||'document.pdf')):'article.html';
  return parseRecord(await capture({bytes:result.bytes,filename,source_kind:kind,source_key:url,source_url:url,metadata}));
}

/** Patch optional fields without rewriting raw/parsed evidence or rerunning OCR. Caller holds the ingest lock. */
export async function updateArticleMetadata(idOrSlug,input) {
  const patch=normalizeArticleMetadata(input),m=await manifest();
  const record=Object.values(m.documents).find(d=>d.id===idOrSlug||d.wiki_slug===idOrSlug);
  if(!record)throw new Error('找不到已导入的文献');
  const page=await readPage(record.wiki_slug);
  if(!page)throw new Error('文献尚未解析完成');
  const merged=normalizeArticleMetadata({...record.article_metadata,...patch});
  normalizeArticleMetadata({sample_start:page.frontmatter.sample_start??null,sample_end:page.frontmatter.sample_end??null,...merged});
  const fm={...page.frontmatter,...patch};
  if(Object.hasOwn(patch,'document_type')&&!Object.hasOwn(patch,'tags')) {
    fm.tags=[...new Set([...(fm.tags??[]).filter(t=>t!==page.frontmatter.document_type&&t!=='待分类'),...(patch.document_type?[patch.document_type]:[])])];
    merged.tags=fm.tags;
  }
  fm.tags=withEntityTags(fm,page.frontmatter).tags;
  if(!fm.tags.length && patch.tags===null)fm.tags=null;
  merged.tags=fm.tags;
  await writePage(page.slug,matter.stringify('',fm).replace(/\n*$/,'\n')+page.body,{baseHash:page.hash});
  record.article_metadata=merged;
  record.metadata_removed_tags=[...new Set([...(record.metadata_removed_tags??[]),...(page.frontmatter.tags??[]).filter(t=>!(fm.tags??[]).includes(t))])].filter(t=>!(fm.tags??[]).includes(t));
  if(Object.hasOwn(patch,'document_type'))record.document_type=patch.document_type;
  record.updated_at=now();record.metadata_updated_at=record.updated_at;
  await saveRecord(record);
  return record;
}
export async function importIma(name=config.imaKnowledgeBase,limit=3,{captureOnly=false,nextOnly=false}={}) {
  const kb=await findKnowledgeBase(name),kbId=kb.kb_id||kb.id;
  let items=await listKnowledge(kbId,nextOnly?10000:limit);const results=[];
  if(nextOnly) {
    const m=await manifest();
    items=items.filter(item=>!['parsed','indexed'].includes(m.documents[sha(`ima:${kbId}:${item.media_id}`).slice(0,24)]?.status)).slice(0,limit);
  }
  for(const item of items) {
    const source_key=`ima:${kbId}:${item.media_id}`,id=sha(source_key).slice(0,24),m=await manifest();
    if(['parsed','indexed'].includes(m.documents[id]?.status)&&item.media_type!==11){results.push({id,title:item.title,status:'skipped'});continue;}
    try {
      const media=await ima('openapi/wiki/v1/get_media_info',{media_id:item.media_id});
      let bytes,filename=item.title,url=null;
      if(media.media_type===11&&media.notebook_ext_info?.notebook_id) {
        const note=await ima('openapi/note/v1/get_doc_content',{note_id:media.notebook_ext_info.notebook_id,target_content_format:0});
        if(typeof note.content!=='string')throw new Error('IMA 笔记未返回正文');
        bytes=Buffer.from(note.content,'utf8');filename=item.title+'.txt';
      } else {
        if(!media.url_info?.url)throw new Error('IMA 未提供可下载原文，请使用 IMA 客户端查看原文');
        const fetched=await download(media.url_info.url,media.url_info.headers||{});bytes=fetched.bytes;
        // Signed COS URLs and temporary headers never enter provenance or logs.
        if([2,6].includes(media.media_type)){url=media.url_info.url;filename=item.title+'.html';}
      }
      const record=await capture({bytes,filename,title:item.title,source_kind:'ima',source_key,source_url:url,
        source_meta:{knowledge_base:name,knowledge_base_id:kbId,media_id:item.media_id},media_type:media.media_type});
      const done=captureOnly?record:await parseRecord(record);
      results.push({id:done.id,title:done.title,status:done.status});
    } catch(e) {results.push({id,title:item.title,status:'failed',error:e.message});}
  }
  await atomicJson(dataPath('state','last-ima-import.json'),{at:now(),knowledge_base:name,results});return results;
}
const { researchRelations: RELATION_TYPES } = await import('./research-schema.mjs');
const indexStatePath=dataPath('state','index-state.json');

/** Slug gbrain assigns to a wiki file (lowercased path without extension). */
function wikiSlugOf(file) {
  return slash(path.relative(dataPath('wiki'),file)).replace(/\.md$/,'').toLowerCase();
}

/** Relation targets declared in a page's frontmatter: [{type,to}]. Throws on missing targets. */
async function declaredRelations(file) {
  const {data}=matter(await fs.readFile(file,'utf8'));
  const out=[];
  for(const type of RELATION_TYPES) {
    const values=Array.isArray(data[type])?data[type]:data[type]?[data[type]]:[];
    for(const value of values) {
      const to=String(value).replace(/^\[\[|\]\]$/g,'').split('|')[0].trim().toLowerCase();
      if(!/^[\p{L}\p{N}_\-./]+$/u.test(to)||to.split('/').some(s=>/^\.+$/.test(s)))throw new Error('无效关联页面：'+to);
      await fs.access(dataPath('wiki',to+'.md'));
      out.push({type,to});
    }
  }
  return out;
}

/**
 * Project frontmatter relations onto GBrain typed links. Custom frontmatter
 * inference is not uniform upstream, so declared relations go through the
 * idempotent `link` operation. When `previous` (from the links table) is
 * supplied, relations no longer declared are removed.
 */
export async function projectTypedLinks(files,{previous=null}={}) {
  let created=0,removed=0;
  for(const file of files) {
    const from=wikiSlugOf(file);
    const wanted=await declaredRelations(file);
    for(const {type,to} of wanted){await gb(['link',from,to,'--link-type',type]);created++;}
    const old=previous?.get(from)??[];
    for(const {type,to} of old) {
      if(wanted.some(w=>w.type===type&&w.to===to))continue;
      await gb(['unlink',from,to,'--link-type',type,'--link-source','manual']);removed++;
    }
  }
  return {created,removed};
}

async function wikiFiles() {
  return (await filesBelow(dataPath('wiki'))).filter(x=>x.endsWith('.md')&&!x.endsWith(`${path.sep}index.md`));
}

async function markIndexed() {
  const m=await manifest();for(const doc of Object.values(m.documents))if(doc.status==='parsed'){doc.status='indexed';doc.indexed_at=now();}
  await atomicJson(manifestPath,m);
  await atomicJson(indexStatePath,{...await readJson(indexStatePath,{}),last_index_at:now()});
  return {indexed:Object.values(m.documents).filter(x=>x.status==='indexed').length};
}

async function syncMetadataTags() {
  const m=await manifest();let changed=false;
  for(const doc of Object.values(m.documents)) {
    if(!doc.metadata_removed_tags?.length)continue;
    for(const tag of doc.metadata_removed_tags)await gb(['untag',doc.wiki_slug,tag]);
    doc.metadata_removed_tags=[];changed=true;
  }
  if(changed)await atomicJson(manifestPath,m);
}

/** Full pipeline: catalogue → import → link extraction → typed relations → embeddings. */
export async function indexWiki() {
  const catalog=await manifest();
  await fs.writeFile(dataPath('wiki','文献目录.md'),'---\ntitle: 文献目录\ntype: note\n---\n# 文献目录\n\n'+Object.values(catalog.documents).filter(d=>['parsed','indexed'].includes(d.status)).map(d=>`- [[${d.wiki_slug}|${d.title}]]`).join('\n')+'\n\n[[concepts/研究方法|研究方法]]\n');
  await gb(['import',dataPath('wiki'),'--no-embed'],{timeout:600000,logFile:dataPath('logs','gbrain-import.log')});
  await syncMetadataTags();
  await gb(['extract','links','--source','fs','--dir',dataPath('wiki'),'--include-frontmatter'],{timeout:600000,logFile:dataPath('logs','gbrain-links.log')});
  await projectTypedLinks(await wikiFiles());
  await gb(['embed','--stale'],{timeout:3600000,logFile:dataPath('logs','gbrain-embed.log')});
  return markIndexed();
}

/**
 * Incremental re-index after in-browser edits. `import` skips unchanged files
 * by content hash, link extraction is limited to pages touched since the last
 * run, and typed relations are re-projected only for the edited slugs.
 */
export async function reindexPages(slugs=[],{previousLinks=null}={}) {
  const state=await readJson(indexStatePath,{});
  await gb(['import',dataPath('wiki'),'--no-embed'],{timeout:600000,logFile:dataPath('logs','gbrain-import.log')});
  await syncMetadataTags();
  const extractArgs=['extract','links','--source','fs','--dir',dataPath('wiki'),'--include-frontmatter'];
  if(state.last_index_at)extractArgs.push('--since',state.last_index_at);
  await gb(extractArgs,{timeout:600000,logFile:dataPath('logs','gbrain-links.log')});
  const files=slugs.length?slugs.map(s=>dataPath('wiki',s+'.md')):await wikiFiles();
  const existing=[];for(const f of files){try{await fs.access(f);existing.push(f);}catch{}}
  const links=await projectTypedLinks(existing,{previous:previousLinks});
  await gb(['embed','--stale'],{timeout:3600000,logFile:dataPath('logs','gbrain-embed.log')});
  return {...await markIndexed(),reindexed:existing.map(wikiSlugOf),...links};
}
