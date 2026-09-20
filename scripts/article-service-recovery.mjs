const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

/** Preserve transport diagnostics without recording headers, credentials or response bodies. */
export function serviceErrorDetails(error) {
  const causes=[];
  for(let cause=error?.cause;cause&&causes.length<4;cause=cause.cause) {
    causes.push({name:cause.name,code:cause.code,syscall:cause.syscall});
    if(Array.isArray(cause.errors))for(const item of cause.errors.slice(0,4))causes.push({name:item.name,code:item.code,syscall:item.syscall});
  }
  return {name:error?.name,code:error?.code,http_status:error?.httpStatus,causes};
}

export function serviceFailureKind(error) {
  if(['CODEBUDDY_CONFIG','STRUCTURED_OUTPUT_CONFIG'].includes(error?.code))return 'fatal';
  const status=error?.httpStatus??error?.http_status;
  if([401,402,403].includes(status)||/HTTP (401|402|403)\b/.test(error?.message??''))return 'fatal';
  if([408,429,500,502,503,504].includes(status))return 'transient';
  if(error?.code==='VALIDATION'||error instanceof SyntaxError)return 'other';
  const codes=[error?.code,...serviceErrorDetails(error).causes.map(c=>c.code)];
  if(codes.some(c=>/^(?:LLM_SERVICE_UNAVAILABLE|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN|ENOTFOUND|EPIPE|UND_ERR_CONNECT_TIMEOUT|UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|UND_ERR_SOCKET)$/.test(c??'')))return 'transient';
  if(error?.name==='TimeoutError'||/fetch failed|连接或响应异常/.test(error?.message??''))return 'transient';
  return 'other';
}

export function serviceRecoveryState(cfg,documentId,attempt=1,at=Date.now(),error=null) {
  const delayMs=Math.min(300000,30000*2**Math.min(4,Math.max(0,attempt-1)));
  return {model:cfg.model,endpoint:cfg.baseUrl,document_id:documentId,attempt,next_probe_at:new Date(at+delayMs).toISOString(),delay_ms:delayMs,error:error?.message,error_details:serviceErrorDetails(error)};
}

/** A read-only readiness check. Only the configured endpoint and exact selected model qualify. */
export async function probeArticleService(cfg,{fetchImpl=fetch}={}) {
  // The official CLI has no separate readiness endpoint. After the persisted cooldown,
  // retry the pending document itself; never spend credits on synthetic health prompts.
  if(cfg.transport==='codebuddy-cli')return {kind:'healthy'};
  try {
    const response=await fetchImpl(cfg.baseUrl.replace(/\/$/,'')+'/models',{headers:{authorization:'Bearer '+cfg.apiKey},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!response.ok) {
      await response.body?.cancel();
      const error=Object.assign(new Error('模型服务检查 HTTP '+response.status),{httpStatus:response.status});
      return {kind:[400,401,402,403,404,405,422].includes(response.status)?'fatal':'waiting',error};
    }
    const body=await response.json();
    if(!Array.isArray(body?.data))return {kind:'waiting',error:new Error('模型服务检查未返回有效模型列表')};
    if(!body.data.some(row=>row.id===cfg.model))return {kind:'waiting',error:new Error('模型服务尚未提供所选模型')};
    return {kind:'healthy'};
  }catch(error){return {kind:serviceFailureKind(error)==='fatal'?'fatal':'waiting',error};}
}

/** Stays alive across outages; the caller persists each update for restart recovery. */
export async function waitForArticleService(cfg,initial,{shouldPause,onUpdate,probe=probeArticleService,sleep=wait,clock=Date.now}) {
  let state=initial;
  for(;;) {
    await onUpdate(state);
    while(clock()<Date.parse(state.next_probe_at)) {
      if(await shouldPause())return {kind:'paused',state};
      await sleep(Math.min(1000,Date.parse(state.next_probe_at)-clock()));
    }
    if(await shouldPause())return {kind:'paused',state};
    const result=await probe(cfg);
    if(await shouldPause())return {kind:'paused',state};
    if(result.kind==='healthy')return {kind:'recovered',state};
    if(result.kind==='fatal')return {kind:'fatal',state,error:result.error};
    state=serviceRecoveryState(cfg,state.document_id,state.attempt+1,clock(),result.error);
  }
}
