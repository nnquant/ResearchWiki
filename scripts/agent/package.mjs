import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const files = ['scripts/agent/client.mjs', 'scripts/agent/cli.mjs', 'scripts/agent/mcp.mjs', 'scripts/agent/mcp-server.mjs', 'scripts/agent/verify.mjs',
  'scripts/agent/tools.mjs', 'scripts/query/contract.mjs', 'scripts/server/errors.mjs', 'skills/researchwiki/SKILL.md', 'docs/agent-access.md'];
export async function packageAgent(destination = path.join(repo, 'outputs/researchwiki-agent')) {
  const target = path.resolve(destination);
  for (const file of files) {
    await fs.mkdir(path.dirname(path.join(target, file)), { recursive: true });
    await fs.copyFile(path.join(repo, file), path.join(target, file));
  }
  const manifest = JSON.parse(await fs.readFile(path.join(repo, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(target, 'package.json'), JSON.stringify({ name: 'researchwiki-agent-client', version: '1.1.0', private: true, type: 'module',
    engines: { node: '>=22' }, scripts: { research: 'node scripts/agent/cli.mjs', mcp: 'node scripts/agent/mcp.mjs', verify: 'node scripts/agent/verify.mjs' },
    dependencies: { '@modelcontextprotocol/sdk': manifest.dependencies['@modelcontextprotocol/sdk'] } }, null, 2) + '\n');
  return target;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(await packageAgent());
