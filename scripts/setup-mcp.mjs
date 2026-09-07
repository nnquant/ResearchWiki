import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath,gb,atomicJson,repo } from './common.mjs';
const tokenFile=dataPath('runtime','mcp-read-token');
try{await fs.access(tokenFile);}catch{
  const result=await gb(['auth','create','quant-wiki-reader','--scopes','read']);
  const token=(result.stdout+'\n'+result.stderr).match(/gbrain_[A-Za-z0-9_-]+/)?.[0];
  if(!token)throw new Error('无法读取新生成的只读 token；请检查 auth list，不要重复创建');
  await fs.writeFile(tokenFile,token+'\n',{flag:'wx'});
}
const readConfig={mcpServers:{'quant-research-wiki':{command:process.execPath,args:[path.join(repo,'scripts','mcp-stdio.mjs')]}}};
await atomicJson(path.join(repo,'config','mcp.json'),readConfig);
console.log('只读 MCP token 已保存在本机 runtime；接入配置：config/mcp.json');
