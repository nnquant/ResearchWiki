import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { deduplicateFile, exportTree, digest } from '../scripts/report-storage.mjs';
import { completedRecord } from '../scripts/deduplicate-reports.mjs';

const root=path.resolve('work',`storage-tests-${process.pid}`);
test.after(()=>fs.rm(root,{recursive:true,force:true}));
test('dedup replaces only identical bytes, preserves source, and is restartable',async()=>{
  await fs.mkdir(root,{recursive:true});
  const source=path.join(root,'source.pdf'),target=path.join(root,'target.pdf');
  await fs.writeFile(source,'original');await fs.writeFile(target,'different');
  assert.equal((await deduplicateFile(source,target)).status,'different_content');
  assert.equal(await fs.readFile(target,'utf8'),'different');
  await fs.writeFile(target,'modified'); // Same byte count, different content.
  assert.equal((await deduplicateFile(source,target)).status,'different_content');
  assert.equal(await fs.readFile(target,'utf8'),'modified');
  await fs.writeFile(target,'original');
  assert.equal((await deduplicateFile(source,target,'wrong hash')).status,'different_content');
  const before=await fs.stat(source);
  assert.equal((await deduplicateFile(source,target,digest(Buffer.from('original')))).status,'linked');
  assert.equal((await fs.stat(target)).ino,before.ino);
  assert.equal((await fs.stat(source)).mtimeMs,before.mtimeMs);
  assert.equal((await deduplicateFile(source,target)).status,'already_linked');
  await fs.unlink(target);assert.equal(await fs.readFile(source,'utf8'),'original');
});
test('exports share parser evidence but editable text stays independent',async()=>{
  const source=path.join(root,'parsed'),target=path.join(root,'export');
  await fs.mkdir(source,{recursive:true});
  for(const name of ['image.jpg','document_middle.json','document.md','remote-job.json'])await fs.writeFile(path.join(source,name),'data');
  await exportTree(source,target);await exportTree(source,target);
  for(const name of ['image.jpg','document_middle.json'])assert.equal((await fs.stat(path.join(source,name))).ino,(await fs.stat(path.join(target,name))).ino);
  for(const name of ['document.md','remote-job.json'])assert.notEqual((await fs.stat(path.join(source,name))).ino,(await fs.stat(path.join(target,name))).ino);
  await fs.writeFile(path.join(target,'document.md'),'edited');assert.equal(await fs.readFile(path.join(source,'document.md'),'utf8'),'data');
});
test('unprocessed, failed, missing and mismatched reports never qualify',()=>{
  const item={relative:'x.pdf'},event={status:'completed',document_id:'id'},report={status:'parsed',sha256:'hash',source_relative:'x.pdf'},doc={id:'id',status:'parsed',sha256:'hash'};
  assert.ok(completedRecord(item,event,report,doc));
  for(const status of ['failed','parsing','captured','processing'])assert.ok(!completedRecord(item,event,report,{...doc,status}));
  assert.ok(!completedRecord(item,{...event,status:'failed'},report,doc));
  assert.ok(!completedRecord(item,event,undefined,doc));
  assert.ok(!completedRecord(item,event,report,{...doc,sha256:'other'}));
});
