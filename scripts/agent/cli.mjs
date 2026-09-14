import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { agentRequest } from './client.mjs';
import { agentTools } from './tools.mjs';
import { combine, tagsFilter } from '../query/contract.mjs';
export async function main(args = process.argv.slice(2)) {
  const [operation = 'help', ...rest] = args;
  if (operation === 'help' || operation === '--help') {
    console.log(JSON.stringify({ usage: 'node scripts/agent/cli.mjs <describe|resolve|query|search|read|related> [text/id] [--url URL] [--token-file FILE] [--request file.json|-] [--tag TAG] [--tag-any TAG] [--exclude-tag TAG] [--json]', environment: ['RESEARCHWIKI_URL', 'RESEARCHWIKI_TOKEN', 'RESEARCHWIKI_TOKEN_FILE'], tools: agentTools }, null, 2)); return;
  }
  if (!agentTools.some(t => t.name === `research_${operation}`)) throw Object.assign(new Error('未知操作；使用 help 查看接口'), { code: 'INVALID_ARGUMENT' });
  let request = {}, positional = [], tags = { tags_all: [], tags_any: [], tags_none: [] }, connection = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (flag === '--json') continue;
    if (!flag.startsWith('--')) { positional.push(flag); continue; }
    if (flag === '--explain') { request.explain = true; continue; }
    const value = rest[++i];
    if (value == null) throw Object.assign(new Error(`${flag} 缺少值`), { code: 'INVALID_ARGUMENT' });
    if (flag === '--url') { connection.baseUrl = value; continue; }
    if (flag === '--token-file') { connection.tokenFile = value; continue; }
    if (flag === '--request') {
      let raw = '';
      if (value === '-') { for await (const part of process.stdin) raw += part; }
      else raw = await fs.readFile(value, 'utf8');
      request = { ...request, ...JSON.parse(raw.replace(/^\uFEFF/, '')) }; continue;
    }
    const tagKey = { '--tag': 'tags_all', '--tag-any': 'tags_any', '--exclude-tag': 'tags_none' }[flag];
    if (tagKey) { tags[tagKey].push(value); continue; }
    const name = flag.slice(2).replaceAll('-', '_');
    if (!['mode', 'section', 'kind', 'view', 'cursor', 'revision_id', 'block_id', 'find', 'sort', 'direction', 'group_by', 'expected_id', 'limit', 'page', 'start_block', 'neighbors', 'depth', 'max_response_tokens', 'timeout_ms'].includes(name)) throw Object.assign(new Error(`未知参数 ${flag}`), { code: 'INVALID_ARGUMENT' });
    request[name] = ['limit', 'page', 'start_block', 'neighbors', 'depth', 'max_response_tokens', 'timeout_ms'].includes(name) ? Number(value) : value;
  }
  if (positional.length) request[['read', 'related'].includes(operation) ? 'id' : operation === 'search' ? 'query' : 'q'] = positional.join(' ');
  const tf = tagsFilter(tags); if (tf) request.filters = combine(request.filters, tf);
  const controller = new AbortController(), stop = () => controller.abort(); process.once('SIGINT', stop);
  try { console.log(JSON.stringify(await agentRequest(operation, request, { ...connection, signal: controller.signal }), null, 2)); }
  finally { process.removeListener('SIGINT', stop); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(e => { console.log(JSON.stringify({ error: e.message, code: e.code ?? 'CLIENT_ERROR' })); process.exitCode = ['INVALID_ARGUMENT', 'INVALID_CURSOR'].includes(e.code) ? 2 : 1; });
}
