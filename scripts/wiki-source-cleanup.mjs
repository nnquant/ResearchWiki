import fs from 'node:fs/promises';
import path from 'node:path';
import {repo,dataPath,sha,now,atomicJson} from './common.mjs';
import {CLEANUP_VERSION,SOURCE_BODY_BOUNDARY,cleanWikiAds} from './wiki-ad-cleanup.mjs';

// An explicit boundary prevents provenance and unpaged report text being mixed in search.
export async function prepareWikiSource(record,body) {
  const rules=JSON.parse(await fs.readFile(path.join(repo,'config/wiki-ad-cleanup.json'),'utf8'));
  if(rules.version!==CLEANUP_VERSION||!Array.isArray(rules.imageHashes))throw new Error('Wiki 广告清理规则无效');
  const result=cleanWikiAds(body,{imageHashes:rules.imageHashes,unpaged:true});
  const counts={};for(const item of result.removed)counts[item.kind]=(counts[item.kind]??0)+1;
  const auditPath=dataPath('state','wiki-ad-cleanup',record.id,record.revision+'.json');
  const metadata={version:CLEANUP_VERSION,cleaned_at:now(),content_scope:'source-markdown',
    original_body_sha256:sha(body),cleaned_body_sha256:sha(result.body),changed:result.changed,
    removed:counts,audit_path:path.relative(dataPath(),auditPath).replaceAll('\\','/')};
  await atomicJson(auditPath,{...metadata,document_id:record.id,revision:record.revision,
    raw_path:record.raw_path,parsed_path:record.paged_path??record.parsed_path,
    removals:result.removed,image_candidates:result.candidates});
  return {body:SOURCE_BODY_BOUNDARY+result.body,metadata};
}
