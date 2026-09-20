import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadRegistry, entityMentions, resolveMention } from '../scripts/query/entities.mjs';

test('a fresh installation works without private entity files and retains observed names', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'wiki-registry-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const url = pathToFileURL(directory + path.sep);
  const empty = await loadRegistry(url);
  assert.equal(empty.entities.size, 0);
  assert.equal(empty.contextRules.size, 0);
  assert.deepEqual(empty.relations, []);
  const [mention] = entityMentions({ companies: ['Example Company'] });
  assert.equal(resolveMention(mention, empty).status, 'observed');

  const entity = { entity_id: 'entity:company:example', type: 'company', name: 'Example Company', aliases: ['Example'], source: 'test' };
  await fs.writeFile(new URL('entity-registry.json', url), JSON.stringify({ version: 1, entities: [entity] }));
  const configured = await loadRegistry(url);
  assert.equal(resolveMention(mention, configured).status, 'curated');
  assert.notEqual(configured.version, empty.version);

  await fs.writeFile(new URL('entity-context-rules.json', url), 'invalid json');
  await assert.rejects(loadRegistry(url), SyntaxError);
});
