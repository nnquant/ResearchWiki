import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { createShareGuide } from '../scripts/agent/create-share-guide.mjs';

const work = path.resolve('work', `agent-skill-install-${process.pid}`);
const token = 'fixture-read-token-not-a-real-credential';
await fs.mkdir(work, { recursive: true });
const server = http.createServer(async (req, res) => {
  res.setHeader('content-type', 'application/json');
  if (req.headers.authorization !== `Bearer ${token}`) { res.writeHead(401); res.end(JSON.stringify({ code: 'UNAUTHORIZED' })); return; }
  let input = ''; for await (const chunk of req) input += chunk;
  res.end(JSON.stringify({ results: [{ operations: ['describe', 'query', 'search'] }], input: JSON.parse(input || '{}') }));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: work, windowsHide: true });
    let stdout = '', stderr = ''; child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
  });
}
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(work, { recursive: true, force: true }); });

test('one Markdown contains the token and a complete executable installer; installed helper works from another cwd', async () => {
  const output = await createShareGuide({ baseUrl, token, outputDir: path.join(work, 'guide') });
  const doc = await fs.readFile(output.document, 'utf8');
  assert.ok(doc.includes(token));
  const embedded = doc.match(/```javascript\n([\s\S]+?)\n```/)[1];
  assert.equal(embedded, (await fs.readFile(output.script, 'utf8')).trim());
  const extracted = path.join(work, 'extracted.mjs'); await fs.writeFile(extracted, embedded);
  const target = path.join(work, 'Research Skill 安装');
  const install = await run([extracted, '--target', target]);
  assert.equal(install.code, 0, install.stderr + install.stdout);
  assert.ok(install.stdout.includes('连接验证通过')); assert.ok(!install.stdout.includes(token));
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'connection.json'), 'utf8')), { base_url: baseUrl, token });
  const skill = await fs.readFile(path.join(target, 'SKILL.md'), 'utf8');
  assert.ok(!skill.includes('__RESEARCHWIKI_SKILL_DIR__'));
  assert.ok(skill.includes(target.replaceAll('\\', '/'))); assert.ok(!skill.includes(token));
  const result = await run([path.join(target, 'scripts/research.mjs'), 'query', '--tag', '公司:000001']);
  assert.equal(result.code, 0, result.stderr); assert.ok(JSON.stringify(JSON.parse(result.stdout).input.filters).includes('公司:000001'));
  assert.ok(!result.stdout.includes(token));
  const dictionary = await run([path.join(target, 'scripts/research.mjs'), 'describe', '半导体', '--section', 'tags']);
  assert.equal(dictionary.code, 0, dictionary.stderr);
  assert.deepEqual(JSON.parse(dictionary.stdout).input, { section: 'tags', q: '半导体' });
  const graph = await run([path.join(target, 'scripts/research.mjs'), 'graph', '--operation', 'overview', '--group-by', 'entity']);
  assert.equal(graph.code, 0, graph.stderr);
  assert.deepEqual(JSON.parse(graph.stdout).input, { operation: 'overview', group_by: 'entity' });
  // Relative references must survive installation outside the repository.
  for (const [, relative] of skill.matchAll(/\]\(([^)]+\.md)\)/g)) await fs.access(path.resolve(target, relative));
  const again = await run([extracted, '--target', target]); assert.equal(again.code, 0, again.stderr);
});

test('installer refuses to overwrite an existing unrelated skill', async () => {
  const output = await createShareGuide({ baseUrl, token, outputDir: path.join(work, 'overwrite') });
  const target = path.join(work, 'existing'); await fs.mkdir(target); await fs.writeFile(path.join(target, 'SKILL.md'), 'existing skill');
  const result = await run([output.script, '--target', target]); assert.equal(result.code, 1);
  assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), 'existing skill');
  await assert.rejects(fs.access(path.join(target, 'connection.json')));
});

test('invalid credentials fail verification without printing token, while leaving installation for repair', async () => {
  const output = await createShareGuide({ baseUrl, token: 'wrong-secret', outputDir: path.join(work, 'bad-auth') });
  const target = path.join(work, 'bad-auth-install');
  const result = await run([output.script, '--target', target]); assert.equal(result.code, 1);
  assert.ok(result.stdout.includes('UNAUTHORIZED')); assert.ok(!result.stdout.includes('wrong-secret'));
  await fs.access(path.join(target, 'SKILL.md'));
});
