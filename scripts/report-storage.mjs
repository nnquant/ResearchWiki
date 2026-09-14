import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicRename } from './atomic-rename.mjs';

// Only parser evidence and originals are shared. Editable text and state remain independent.
export const shareable = file => /\.(pdf|png|jpg|jpeg|gif|webp)$/i.test(file) || /_((middle|model|content_list|content_list_v2))\.json$/i.test(file);
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = s => `${s.dev}:${s.ino}:${s.size}:${s.mtimeMs}`;
export async function regular(file) {
  const absolute = path.resolve(file);
  const resolved = await fs.realpath(absolute);
  const normalize = value => process.platform==='win32' ? value.toLowerCase() : value;
  if(normalize(resolved)!==normalize(absolute)) throw new Error(`Link path rejected: ${absolute}`);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile()) throw new Error(`Not a regular file: ${file}`);
  return stat;
}
export async function deduplicateFile(source, target, expectedHash) {
  const [a,b] = await Promise.all([regular(source), regular(target)]);
  if (a.dev === b.dev && a.ino === b.ino) return { status:'already_linked', bytes:0 };
  if (a.size !== b.size) return { status:'different_content', bytes:0 };
  const [x,y] = await Promise.all([fs.readFile(source),fs.readFile(target)]);
  const hash = digest(x);
  if (hash !== digest(y) || (expectedHash && hash !== expectedHash)) return { status:'different_content', bytes:0 };
  if (a.dev !== b.dev) return { status:'different_volume', bytes:0 };
  const temporary = `${target}.${randomUUID()}.hardlink-tmp`;
  try {
    await fs.link(source, temporary);
    const [aa,bb] = await Promise.all([fs.stat(source),fs.stat(target)]);
    if (identity(a)!==identity(aa) || identity(b)!==identity(bb)) throw new Error('File changed during verification');
    // Atomic replacement; the target is never missing, even if interrupted.
    await atomicRename(temporary, target);
    const after = await fs.stat(target);
    if (after.dev!==a.dev || after.ino!==a.ino) throw new Error('Hardlink verification failed');
    return { status:'linked', bytes:b.nlink===1 ? b.size : 0, sha256:hash };
  } finally { await fs.rm(temporary,{force:true}); }
}

export async function exportFile(source,target) {
  await fs.mkdir(path.dirname(target),{recursive:true});
  if (shareable(source)) {
    await regular(source);
    try { await fs.link(source,target); return; }
    catch(error) {
      if (error.code==='EEXIST') {
        const result=await deduplicateFile(source,target);
        if (['linked','already_linked'].includes(result.status)) return;
        if(result.status==='different_content') throw new Error(`Existing export differs: ${target}`);
      } else if(error.code!=='EXDEV') throw error;
    }
  }
  // Replace instead of writing through a pre-existing hardlink.
  const temporary=`${target}.${randomUUID()}.copy-tmp`;
  try {await fs.copyFile(source,temporary);await atomicRename(temporary,target);}
  finally {await fs.rm(temporary,{force:true});}
}
export async function exportTree(source,target) {
  await fs.mkdir(target,{recursive:true});
  for(const entry of await fs.readdir(source,{withFileTypes:true})) {
    const from=path.join(source,entry.name),to=path.join(target,entry.name);
    if(entry.isSymbolicLink()) throw new Error(`Link path rejected: ${from}`);
    if(entry.isDirectory()) await exportTree(from,to);
    else await exportFile(from,to);
  }
}
