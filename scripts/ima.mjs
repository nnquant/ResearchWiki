import fs from 'node:fs/promises';
import { config, run } from './common.mjs';

export async function ima(operation, body) {
  // Delegate credential loading and official-domain authentication to ima-skill.
  const {stdout} = await run(process.execPath,[config.imaSkill,operation,JSON.stringify(body)],{timeout:90000});
  const response=JSON.parse(stdout);
  if(response.code!==0)throw new Error(`IMA：${response.msg} (${response.code})`);
  return response.data;
}
export async function knowledgeBases(query='群资料汇总') {
  const result=[]; let cursor=''; const seen=new Set();
  while(true) {
    const data=await ima('openapi/wiki/v1/search_knowledge_base',{query,cursor,limit:20});
    result.push(...(data.info_list||[]));
    if(data.is_end)break;
    if(!data.next_cursor||seen.has(data.next_cursor))throw new Error('IMA 知识库游标未推进');
    cursor=data.next_cursor;seen.add(cursor);
  }
  return result;
}
export async function findKnowledgeBase(name) {
  const rows=await knowledgeBases(name);
  const matches=rows.filter(x=>(x.kb_name||x.name)===name);
  if(matches.length!==1)throw new Error(`知识库名称不唯一或不存在：${name}；可选：${rows.map(x=>x.kb_name||x.name).join('、')}`);
  return matches[0];
}
export async function listKnowledge(kb,limit=3) {
  const result=[],queue=[undefined],folders=new Set();
  while(queue.length&&result.length<limit) {
    const folder_id=queue.shift();let cursor='';const seen=new Set();
    while(result.length<limit) {
      const data=await ima('openapi/wiki/v1/get_knowledge_list',{knowledge_base_id:kb,cursor,limit:50,...(folder_id?{folder_id}:{})});
      for(const item of data.knowledge_list||[]) {
        if(item.media_id?.startsWith('folder_')||item.folder_id) {
          const id=item.folder_id||item.media_id;
          if(!folders.has(id)){folders.add(id);queue.push(id);}
        } else if([1,2,6,11].includes(item.media_type)&&result.length<limit) result.push(item);
      }
      if(data.is_end)break;
      if(!data.next_cursor||seen.has(data.next_cursor))throw new Error('IMA 内容游标未推进');
      cursor=data.next_cursor;seen.add(cursor);
    }
  }
  return result;
}
