import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {discoverReports,discoveryRecord,higherPriorityUnparsed} from '../scripts/report-discovery.mjs';

test('rescans both roots, prioritizes new dates and foreign ties, deduplicates and detects changed files',async()=>{
  const dir=await fs.mkdtemp(path.resolve('work/discovery-test-'));
  const sources=['foreign','domestic'].map((name,i)=>({source:path.join(dir,name),output:path.join(dir,'output',name),report_category:i?'内资':'外资'}));
  const write=async(i,name,body)=>{const file=path.join(sources[i].source,'2026年9月',name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);return file;};
  try{
    await write(0,'20260911-old.pdf','old');await write(1,'20260914-new.pdf','domestic');
    const options={sources,documents:[],cache:{},settleMs:0,at:Date.now()+10000};
    let first=await discoverReports(options);assert.deepEqual(first.pending.map(f=>f.date),['2026-09-14','2026-09-11']);
    const newer=await write(0,'20260914-new.pdf','foreign');await write(1,'20260914-duplicate.pdf','foreign');
    let second=await discoverReports(options);assert.equal(second.pending.length,3);assert.equal(second.pending[0].report_category,'外资');
    const blocked=higherPriorityUnparsed({pending:second.pending.map(discoveryRecord)},[],discoveryRecord(first.pending[1]));assert.equal(blocked.source_meta.sort_date,'2026-09-14');
    const allParsed=second.pending.map(f=>({sha256:f.sha256,status:'parsed',parsed_path:'a.md'}));
    assert.equal(higherPriorityUnparsed({pending:second.pending.map(discoveryRecord)},allParsed,null),null);
    assert.equal((await discoverReports({...options,documents:allParsed})).pending.length,0);
    await fs.writeFile(newer,'foreign changed bytes');
    assert.equal((await discoverReports({...options,documents:allParsed})).pending.length,1);
    assert.equal((await discoverReports({...options,at:Date.now(),settleMs:60000})).pending.length,0);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
