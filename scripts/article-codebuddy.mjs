import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {outputLimitError} from './article-output-groups.mjs';

const failure=(message,code='CODEBUDDY_CONFIG',httpStatus)=>Object.assign(new Error(message),{code,httpStatus});
export function codebuddyFailure(text) {
  if(/insufficient|quota.{0,30}(exceed|exhaust)|credits?.{0,30}(exhaust|insufficient)|余额不足|积分不足|额度不足|HTTP\s*402/i.test(text))return failure('CodeBuddy 积分或额度不足（HTTP 402）','CODEBUDDY_BALANCE',402);
  if(/unauthori[sz]ed|not logged|please.{0,15}log.?in|未登录|登录.{0,10}失效|HTTP\s*401/i.test(text))return failure('CodeBuddy 需要重新登录（HTTP 401）','CODEBUDDY_AUTH',401);
  if(/forbidden|permission denied|HTTP\s*403/i.test(text))return failure('CodeBuddy 访问被拒绝（HTTP 403）','CODEBUDDY_AUTH',403);
  if(/rate.?limit|too many requests|HTTP\s*429|限流/i.test(text))return failure('CodeBuddy 暂时限流','LLM_SERVICE_UNAVAILABLE',429);
  if(/ECONNRESET|ECONNREFUSED|ETIMEDOUT|fetch failed|timed? ?out|timeout|temporarily unavailable|service unavailable|HTTP\s*50[0234]/i.test(text))return failure('CodeBuddy 暂时连接失败','LLM_SERVICE_UNAVAILABLE');
  if(/context.{0,40}(length|window|limit)|too many tokens|input.{0,30}too long/i.test(text))return failure('模型服务端上下文窗口不足','CONTEXT_LENGTH');
  if(/truncated due to (?:output )?length|output length limits|repeatedly truncated/i.test(text))return outputLimitError();
  return failure('CodeBuddy 配置或执行失败，已停止，未切换其他模型');
}

const eventText=e=>(typeof e.content==='string'?e.content:(e.message?.content??e.content??[]).filter(c=>['text','output_text','input_text'].includes(c.type)).map(c=>c.text??'').join(''));
export function codebuddyEventError(event,model) {
  const finish=event.event?.delta?.stop_reason??event.message?.stop_reason??event.providerData?.finish_reason??event.providerData?.finishReason;
  if(['length','max_tokens'].includes(finish))return outputLimitError();
  if(/^(?:Your previous response was truncated|Response was (?:repeatedly )?truncated)/i.test(eventText(event).trim()))return outputLimitError();
  const actual=event.event?.message?.model??event.message?.model??event.providerData?.model??(event.type==='message'?event.model:null);
  if(actual&&actual!==model)return failure('CodeBuddy 实际返回模型与指定优惠模型不一致：'+actual);
  if(event.modelUsage&&Object.keys(event.modelUsage).some(key=>key!==model))return failure('CodeBuddy 使用了指定优惠模型之外的模型');
  if(event.type==='function_call'||event.event?.content_block?.type==='tool_use'||(event.message?.content??event.content??[]).some?.(c=>c.type==='tool_use'||c.type==='function_call'))return failure('CodeBuddy 意外调用工具，已停止');
  return null;
}

export function parseCodebuddyCredits(text,pid,since=-Infinity) {
  const credits=new Map();
  for(const line of text.split('\n')) {
    if(!line.includes('[pid='+pid+']')||!line.includes('[SessionManager][credit]'))continue;
    if(Number.isFinite(since)){const timestamp=line.match(/^\[([^\]]+)\]/)?.[1];if(!timestamp||!(Date.parse(timestamp)>=since))continue;}
    const match=line.match(/rootRequestId=([^,]+), source=raw_model_stream_event, credit=([\d.]+)/);
    if(match&&Number.isFinite(Number(match[2])))credits.set(match[1],Number(match[2]));
  }
  return credits.size?[...credits.values()].reduce((sum,n)=>sum+n,0):null;
}

async function reportedCredits(cfg,pid,started) {
  if(!cfg.cliLogDirectory||!pid)return null;
  const dateKey=date=>[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
  let text='';
  for(const day of new Set([dateKey(started),dateKey(new Date())])) {
    const folder=path.join(cfg.cliLogDirectory,day);
    for(const name of await fs.readdir(folder).catch(()=>[])) {
      if(!name.startsWith(path.basename(cfg.cliWorkingDirectory)+'__')||!name.endsWith('.log'))continue;
      const file=await fs.open(path.join(folder,name),'r');
      try{const stat=await file.stat(),size=Math.min(stat.size,1024*1024),buffer=Buffer.alloc(size);await file.read(buffer,0,size,stat.size-size);text+=buffer.toString('utf8');}finally{await file.close();}
    }
  }
  return parseCodebuddyCredits(text,pid,started.getTime());
}

/** Accept only a completed response from the exact requested model; retain real credit usage. */
export function decodeCodebuddyOutput(stdout,model) {
  let decoded;try{decoded=JSON.parse(stdout);}catch{throw failure('CodeBuddy 返回格式无效，已停止');}
  const events=Array.isArray(decoded)?decoded:[decoded];
  for(const event of events){const error=codebuddyEventError(event,model);if(error)throw error;}
  const result=events.findLast(e=>e.type==='result');
  if(!result||result.is_error||result.subtype!=='success')throw codebuddyFailure(JSON.stringify(result??events));
  const messages=events.filter(e=>e.type==='assistant'||e.type==='message'&&e.role==='assistant').map(e=>e.type==='assistant'?{...e.message,status:e.message.stop_reason==='max_tokens'?'incomplete':'completed',providerData:{model:e.message.model}}:e);
  if(!messages.length||messages.some(e=>(e.providerData?.model??e.model)!==model))throw failure('CodeBuddy 响应缺少可验证的模型身份，已停止');
  if(events.some(e=>e.type==='function_call')||messages.some(e=>e.content?.some(c=>c.type==='tool_use'||c.type==='function_call')))throw failure('CodeBuddy 意外调用工具，已停止');
  if(messages.some(e=>e.status!=='completed'))throw failure('CodeBuddy 输出未完整结束，已停止');
  let credits=0,hasCredits=false;const seen=new Set();
  for(const event of messages) {
    const id=event.id??event.providerData?.messageId;if(id&&seen.has(id))continue;if(id)seen.add(id);
    const value=event.providerData?.rawUsage?.credit;
    if(typeof value==='number'&&Number.isFinite(value)){credits+=value;hasCredits=true;}
  }
  const content=result.result;
  if(typeof content!=='string'||!content.trim())throw failure('CodeBuddy 未返回抽取文本，已停止');
  return {model,choices:[{finish_reason:'stop',message:{role:'assistant',content}}],usage:{...result.usage,codebuddy_credits:hasCredits?credits:null},codebuddy:{session_id:result.session_id,duration_ms:result.duration_ms,num_turns:result.num_turns,model}};
}

export async function codebuddyCompletion(cfg,messages,{requestFile,spawnImpl=spawn}={}) {
  if(!cfg.cliPath||!path.isAbsolute(cfg.cliPath)||!cfg.model)throw failure('CodeBuddy 配置缺少绝对 CLI 路径或模型');
  const cwd=path.resolve(cfg.cliWorkingDirectory??path.join(path.dirname(requestFile),'codebuddy-runtime'));
  await fs.mkdir(cwd,{recursive:true});
  const systemFile=path.resolve(requestFile.replace(/\.json$/,'.system.txt'));
  await fs.writeFile(systemFile,messages.filter(m=>m.role==='system').map(m=>m.content).join('\n'),'utf8');
  const input=messages.filter(m=>m.role!=='system').map(m=>m.role==='assistant'?'上一轮模型输出：\n'+m.content:m.content).join('\n\n');
  const args=[cfg.cliPath,'-p','--model',cfg.model,'--output-format','stream-json','--verbose','--include-partial-messages','--tools','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--permission-mode','dontAsk','--no-session-persistence','--max-turns','1','--effort',cfg.reasoningEffort??'low','--settings','{"disableAllHooks":true}','--system-prompt-file',systemFile];
  // Input travels on stdin: no shell interpolation or Windows command-line length limit.
  const env={...process.env};
  for(const key of ['CODEBUDDY_API_KEY','CODEBUDDY_BASE_URL','ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','ANTHROPIC_BASE_URL'])delete env[key];
  return new Promise((resolve,reject)=>{
    let pending='',stderr='',terminalError=null,outputCharacters=0,streamBytes=0;
    const events=[],started=new Date(),decoder=new StringDecoder('utf8');
    const child=spawnImpl(process.execPath,args,{cwd,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
    const timer=setTimeout(()=>{terminalError=failure('CodeBuddy 请求超时','LLM_SERVICE_UNAVAILABLE');child.kill();},cfg.requestTimeoutMs??600000);
    child.on('error',error=>{clearTimeout(timer);reject(failure('CodeBuddy 配置或启动失败：'+(error.code??'unknown')));});
    const accept=event=>{
      if(terminalError)return;
      const error=codebuddyEventError(event,cfg.model);
      if(event.type==='stream_event'&&event.event?.type==='content_block_delta') {
        outputCharacters+=(event.event.delta?.text??'').length;
        if(outputCharacters>(cfg.maxResponseCharacters??24000)){terminalError=outputLimitError('模型输出超过本次字段预算，改用更小字段组');child.kill();return;}
      } else if(event.type!=='stream_event'||['message_start','message_delta','message_stop'].includes(event.event?.type))events.push(event);
      if(error){terminalError=error;child.kill();}
    };
    child.stdout.on('data',data=>{
      streamBytes+=data.length;pending+=decoder.write(data);
      if(pending.length>12000000||streamBytes>80000000){terminalError=outputLimitError('CLI 输出超过单次大小限制');child.kill();return;}
      let end;
      while((end=pending.indexOf('\n'))>=0){const line=pending.slice(0,end).trim();pending=pending.slice(end+1);if(!line)continue;try{accept(JSON.parse(line));}catch{terminalError=failure('CodeBuddy 流式事件格式无效');child.kill();}}
    });
    child.stderr.on('data',data=>{stderr=(stderr+data).slice(-16000);});
    child.stdin.on('error',()=>{});
    child.on('close',async code=>{
      clearTimeout(timer);
      try {
        if(pending.trim()&&!terminalError){try{const tail=JSON.parse(pending);for(const event of Array.isArray(tail)?tail:[tail])accept(event);}catch{terminalError=failure('CodeBuddy 流式事件格式无效');}}
        let result;
        if(!terminalError&&code!==0)terminalError=codebuddyFailure(JSON.stringify(events.findLast(e=>e.type==='result')??{})+'\n'+stderr);
        if(!terminalError){try{result=decodeCodebuddyOutput(JSON.stringify(events),cfg.model);}catch(error){terminalError=error;}}
        const credits=result?.usage?.codebuddy_credits??await reportedCredits({...cfg,cliWorkingDirectory:cwd},child.pid,started).catch(()=>null);
        const usage={...(result?.usage??events.findLast(e=>e.type==='result')?.usage??{}),codebuddy_credits:credits};
        const diagnostics={at:new Date().toISOString(),requested_model:cfg.model,pid:child.pid,exit_code:code,error_code:terminalError?.code,error:terminalError?.message,usage,stream_bytes:streamBytes,output_characters:outputCharacters,events:events.map(e=>({type:e.type,role:e.role??e.message?.role,model:e.providerData?.model??e.message?.model??e.event?.message?.model,status:e.status,subtype:e.subtype,event_type:e.event?.type,finish_reason:e.event?.delta?.stop_reason??e.message?.stop_reason,content_characters:eventText(e).length}))};
        await fs.writeFile(requestFile.replace(/\.json$/,'.cli-'+randomUUID()+'.json'),JSON.stringify(diagnostics,null,2));
        await fs.appendFile(requestFile.replace(/\.json$/,'.usage.jsonl'),JSON.stringify({at:diagnostics.at,seconds:(Date.now()-started.getTime())/1000,usage,error_code:terminalError?.code})+'\n');
        if(terminalError)return reject(terminalError);
        result.usage=usage;resolve(result);
      }catch(error){reject(error);}
    });
    child.stdin.end(input);
  });
}
