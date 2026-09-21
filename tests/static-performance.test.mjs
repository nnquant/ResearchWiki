import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { serveStatic } from '../scripts/server/routes/static.mjs';

const dist = path.resolve('web/dist');
const built = await fs.access(path.join(dist,'index.html')).then(()=>true,()=>false);
test('compressed production files match final Vite output and initial scripts exclude KaTeX', {skip:!built}, async () => {
  const html = await fs.readFile(path.join(dist,'index.html'),'utf8');
  const initial = [...html.matchAll(/(?:src|href)="(\/app\/[^\"]+)"/g)].map(m=>m[1]);
  let transferred=Buffer.byteLength(html);
  for (const name of ['index.html',...(await fs.readdir(path.join(dist,'app'))).filter(f=>/\.(js|css)$/.test(f)).map(f=>'app/'+f)]) {
    const file=path.join(dist,name), original=await fs.readFile(file);
    for (const [extension,decompress] of [['br',brotliDecompressSync],['gz',gunzipSync]]) {
      const bytes=await fs.readFile(file+'.'+extension);
      assert.deepEqual(decompress(bytes),original,name);
      if (extension==='gz' && initial.includes('/'+name)) transferred+=bytes.length;
    }
  }
  assert.ok(transferred<400*1024,`initial gzip bytes: ${transferred}`);
  assert.doesNotMatch(html,/katex/i);
  const initialCss=initial.find(f=>f.endsWith('.css'));
  const css = await fs.readFile(path.join(dist,initialCss),'utf8');
  for (const family of ['Noto Sans', 'Noto Sans SC', 'Noto Sans Mono']) assert.ok(css.includes(family), `restored font: ${family}`);
  assert.ok(Buffer.byteLength(css) < 100 * 1024, 'initial CSS uses bounded font subsets');
  assert.doesNotMatch(css, /noto-sans[^\s"')]*(?:devanagari|cyrillic|greek|vietnamese|latin-ext)/);
});
test('static HEAD, ETag revalidation and encoding negotiation preserve HTTP semantics', {skip:!built}, async () => {
  async function send(method,headers={}) {
    const res={headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(status){this.status=status;},end(body){this.body=body;}};
    await serveStatic({method,headers},res,'/'); return res;
  }
  const get=await send('GET',{'accept-encoding':'br'});
  assert.equal(get.status,200);assert.equal(get.headers['content-encoding'],'br');
  const head=await send('HEAD',{'accept-encoding':'br'});
  assert.equal(head.headers['content-length'],get.body.length);assert.equal(head.body,undefined);
  const cached=await send('GET',{'if-none-match':get.headers.etag});
  assert.equal(cached.status,304);assert.equal(cached.body,undefined);
  const identity=await send('GET',{'accept-encoding':'br;q=0,gzip;q=0'});
  assert.equal(identity.headers['content-encoding'],undefined);
});
