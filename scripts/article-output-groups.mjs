import path from 'node:path';
import {readJson,atomicJson} from './common.mjs';

export const OUTPUT_GROUP_VERSION='output-groups-v1';
export const outputLimitError=(message='模型输出被截断，需要缩小输出字段组')=>Object.assign(new Error(message),{code:'OUTPUT_LIMIT'});
const group=(id,fields,instruction,children=[])=>({id,fields,instruction,children});
const expectationFields=['analyst_expectations'];
export function articleOutputGroups({entitiesOnly=false,expectationsOnly=false}={}) {
  const coreFields=['summary','tags','key_findings','research_category','document_type','authors','institutions','published_at'];
  const entities=['companies','industries','subfields'];
  const result=[];
  if(!entitiesOnly&&!expectationsOnly)result.push(group('core',coreFields,'只输出摘要、标签、结论与有证据的基本书目信息。摘要300字左右；结论最多4条；不自行评价原报告是否完整披露数据。',[
    group('summary',['summary'],'仅输出300字左右摘要及一条原文证据。'),
    group('findings',['tags','key_findings'],'仅输出最多4个标签和4条结论及证据。'),
    group('bibliography',coreFields.filter(f=>!['summary','tags','key_findings'].includes(f)),'仅输出有原文证据的基本书目信息；没有则 metadata:{}。'),
  ]));
  if(!expectationsOnly)result.push(group('entities',entities,'只输出三个研究对象数组，聚焦实质讨论对象，每类最多12项，每项一个短引文。',entities.map(field=>group('entities-'+field,[field],`仅输出 ${field} 数组，最多12项，每项一个短引文；没有则 []。`))));
  result.push(group('expectation-context',expectationFields,'analyst_expectations 中只输出公司标识、评级、目标价及假设/催化剂/风险，不输出 forecasts。最多3家公司，每类说明最多2条。',[
    group('ratings',expectationFields,'只输出公司标识、rating、target_price，不输出 forecasts 或假设/催化剂/风险。最多3家公司。'),
    group('expectation-notes',expectationFields,'只输出公司标识、key_assumptions、catalysts、risks，每类最多2条；不输出评级、目标价或 forecasts。'),
  ]));
  result.push(group('forecasts',expectationFields,'只输出公司标识及 forecasts；不输出评级、目标价或假设/催化剂/风险。最多3家公司，每家公司最多9项未来财年预测，每项至多3个短引文。',[
    group('forecasts-eps',expectationFields,'只输出公司标识及 EPS/adjusted EPS 预测，每家公司未来最多3年；其他字段不输出。'),
    group('forecasts-profit',expectationFields,'只输出公司标识及净利润/调整后净利润预测，每家公司未来最多3年；其他字段不输出。'),
    group('forecasts-other',expectationFields,'只输出公司标识及营收、EBITDA、EBIT、利润率等其他预测，不输出 EPS 或净利润，每家公司最多6项。'),
  ]));
  return result;
}

const unique=values=>[...new Map(values.map(value=>[JSON.stringify(value),value])).values()];
export function mergeArticleGroups(results) {
  const metadata={},evidence=[],discarded=[],expectations=[];
  const identity=e=>String(e.ticker||e.company).normalize('NFKC').toLowerCase().replace(/[\s.,()（）]/g,'');
  for(const result of results) {
    evidence.push(...result.evidence??[]);discarded.push(...result.discarded??[]);
    for(const [key,value] of Object.entries(result.metadata??{})) {
      if(key!=='analyst_expectations'){if(value!=null||!Object.hasOwn(metadata,key))metadata[key]=value;continue;}
      metadata.analyst_expectations??=null;
      for(const entry of value??[]) {
        let current=expectations.find(e=>identity(e)===identity(entry));
        if(!current){current={...entry};expectations.push(current);continue;}
        for(const [field,item] of Object.entries(entry)) {
          if(Array.isArray(item))current[field]=unique([...(current[field]??[]),...item]);
          else if(item!=null) {
            if(current[field]!=null&&JSON.stringify(current[field])!==JSON.stringify(item)&&!['company','ticker'].includes(field))throw Object.assign(new Error('字段组之间存在冲突：'+field),{code:'VALIDATION'});
            current[field]??=item;
          }
        }
      }
    }
  }
  if(expectations.length)metadata.analyst_expectations=expectations;
  return {metadata,evidence:unique(evidence),discarded:unique(discarded)};
}

/** A finite output tree. Every request still contains the unchanged full article. */
export async function runArticleOutputGroups({folder,options,run,validate,shouldPause=async()=>false}) {
  const stateFile=path.join(folder,'output-groups.json');
  const state=await readJson(stateFile,{version:OUTPUT_GROUP_VERSION,split:[],failed:{}});
  if(state.version!==OUTPUT_GROUP_VERSION)throw new Error('抽取分组版本不匹配');
  const results=[],calls=[];
  async function visit(spec) {
    if(await shouldPause())throw Object.assign(new Error('已请求暂停，已完成字段组已保存'),{code:'ARTICLE_PAUSED'});
    const file=path.join(folder,'group-'+spec.id+'.json');
    const saved=await readJson(file,null);
    if(saved){results.push(validate(saved,spec));calls.push(saved.usage??null);return;}
    if(state.failed[spec.id])throw Object.assign(new Error(state.failed[spec.id]),{code:'ARTICLE_OUTPUT_FAILED'});
    if(state.split.includes(spec.id)){for(const child of spec.children)await visit(child);return;}
    try {
      const roster=mergeArticleGroups(results).metadata.analyst_expectations?.map(e=>({company:e.company,ticker:e.ticker}));
      const response=await run(spec,roster);
      const checked=validate(response.parsed,spec);
      await atomicJson(file,{...checked,usage:response.usage??null});
      results.push(checked);calls.push(response.usage??null);
    } catch(error) {
      if(error.code!=='OUTPUT_LIMIT')throw error;
      if(!spec.children.length) {
        state.failed[spec.id]='字段组 '+spec.id+' 达到输出限制；停止该篇，不重复超长请求';await atomicJson(stateFile,state);
        throw Object.assign(new Error(state.failed[spec.id]),{code:'ARTICLE_OUTPUT_FAILED'});
      }
      state.split.push(spec.id);await atomicJson(stateFile,state);
      for(const child of spec.children)await visit(child);
    }
  }
  await atomicJson(stateFile,state);
  for(const spec of articleOutputGroups(options))await visit(spec);
  return {...mergeArticleGroups(results),calls};
}
