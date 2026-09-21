import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
const files=JSON.parse(fs.readFileSync(new URL('../config/shared-core-files.json',import.meta.url),'utf8'));
const [left='main',right='investment']=process.argv.slice(2);
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',windowsHide:true}).trim();
const different=files.filter(file=>git('rev-parse',`${left}:${file}`)!==git('rev-parse',`${right}:${file}`));
if(different.length) {console.error(`Shared core differs (${left} / ${right}):\n${different.join('\n')}`);process.exitCode=1;}
else console.log(`Shared core matches: ${files.length} files (${left} / ${right})`);
