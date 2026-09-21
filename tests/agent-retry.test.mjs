import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { agentRequest } from '../scripts/agent/client.mjs';

test('read client retries once, propagates Retry-After and never retries caller cancellation', async () => {
  let requests = 0, mode = 'recover';
  const oldToken = process.env.RESEARCHWIKI_TOKEN;
  process.env.RESEARCHWIKI_TOKEN = 'fixture';
  const server = http.createServer((req,res) => {
    requests++;
    if (mode === 'wait') return;
    res.setHeader('content-type','application/json');
    if (mode === 'fail' || requests === 1) {
      res.writeHead(mode === 'fail' ? 503 : 429, {'retry-after':'0'});
      res.end(JSON.stringify({code:'TOO_MANY_REQUESTS',error:'busy'}));
    } else res.end(JSON.stringify({results:[]}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const options={baseUrl:`http://127.0.0.1:${server.address().port}`};
  try {
    assert.deepEqual(await agentRequest('query',{},options),{results:[]}); assert.equal(requests,2);
    requests=0;mode='fail';
    await assert.rejects(agentRequest('query',{},options),e=>e.status===503 && e.retry_after==='0'); assert.equal(requests,2);
    requests=0;mode='wait';
    const controller=new AbortController();
    const pending=agentRequest('query',{}, {...options,signal:controller.signal});
    setTimeout(()=>controller.abort(),30);
    await assert.rejects(pending,e=>e.code==='TIMEOUT'); assert.equal(requests,1);
  } finally {
    if (oldToken === undefined) delete process.env.RESEARCHWIKI_TOKEN; else process.env.RESEARCHWIKI_TOKEN=oldToken;
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
  }
});
