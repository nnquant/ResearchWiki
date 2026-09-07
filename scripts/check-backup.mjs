import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { dataPath,repo,sha,atomicJson,now } from './common.mjs';
const dir=process.argv[2];if(!dir)throw new Error('传入备份目录');
const dump=path.join(dir,'gbrain.dump');
await new Promise((resolve,reject)=>{
 const p=spawn('docker',['compose','--env-file',dataPath('runtime','compose.env'),'exec','-T','postgres','pg_restore','--file=/dev/null'],{cwd:repo,windowsHide:true,stdio:['pipe','ignore','pipe']});
 let error='';p.stderr.on('data',b=>error+=b);p.on('error',reject);
 createReadStream(dump).pipe(p.stdin);p.on('close',code=>code===0?resolve():reject(new Error(error)));
});
const report={at:now(),postgres_archive_decoded:true,sha256:sha(await fs.readFile(dump))};
await atomicJson(path.join(dir,'verified.json'),report);console.log(JSON.stringify(report));
