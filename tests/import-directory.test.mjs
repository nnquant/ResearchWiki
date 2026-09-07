import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const folder=path.resolve('work','directory-tests-'+process.pid);
process.env.WIKI_DATA_ROOT=folder;
const {readyFile,completePdf,parallelMap,scanDirectory}=await import('../scripts/import-directory.mjs');

test('download completion requires matching final size; unknown downloads require stability',()=>{
  const stat={size:100,mtimeMs:10},old={signature:'100:10',stable_since:0};
  assert.equal(readyFile(stat,old,{status:'downloading',size:100},90000,60000),false);
  assert.equal(readyFile(stat,old,{status:'done',size:99},90000,60000),false);
  assert.equal(readyFile(stat,null,{status:'done',size:100},0,60000),true);
  assert.equal(readyFile(stat,old,null,90000,60000),true);
  assert.equal(readyFile(stat,old,null,1000,60000),false);
  assert.equal(completePdf(Buffer.from('%PDF-1.7\nincomplete')),false);
});
test('directory scan ignores partial and active downloads and deduplicates completed signatures',async()=>{
  await fs.mkdir(folder,{recursive:true});
  const bytes=Buffer.from('%PDF-1.7\nfixture\n%%EOF\n');
  try {
    for(const name of ['complete.pdf','active.pdf','unclosed.pdf','download.pdf.part'])await fs.writeFile(path.join(folder,name),name==='unclosed.pdf'?Buffer.from('%PDF-1.7'):bytes);
    await fs.writeFile(path.join(folder,'_state.json'),JSON.stringify({'complete.pdf':{status:'done',size:bytes.length},'active.pdf':{status:'downloading'},'unclosed.pdf':{status:'done',size:8}}));
    const state={files:{}};
    const ready=await scanDirectory(folder,state);
    assert.deepEqual(ready.map(x=>path.basename(x.file)),['complete.pdf']);
    state.files[ready[0].file].status='indexed';
    assert.equal((await scanDirectory(folder,state)).length,0);
  } finally {assert.ok(folder.startsWith(path.resolve('work')+path.sep));await fs.rm(folder,{recursive:true,force:true});}
});
test('parallel parsing is bounded at two jobs and preserves result order',async()=>{
  let active=0,max=0;
  const result=await parallelMap([1,2,3,4],2,async n=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;return n;});
  assert.equal(max,2);assert.deepEqual(result,[1,2,3,4]);
});
