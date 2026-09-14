import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { config, dataPath, repo, atomicJson } from '../common.mjs';
import { createShareGuide } from './create-share-guide.mjs';
import { validShareId } from './install-downloads.mjs';

const baseUrl = (process.argv[2] || config.agent?.publicBaseUrl || '').replace(/\/$/, '');
if (!baseUrl) throw new Error('用法：node scripts/agent/publish-install.mjs http://服务器:8020');
const directory = path.join(repo, 'outputs/private'), manifest = path.join(directory, 'install-share.json');
const previous = await fs.readFile(manifest, 'utf8').then(JSON.parse).catch(e => { if (e.code === 'ENOENT') return null; throw e; });
const id = validShareId(previous?.id) ? previous.id : randomBytes(24).toString('base64url');
const downloadBaseUrl = `${baseUrl}/install/${id}`;
const token = await fs.readFile(dataPath('runtime', 'mcp-read-token'), 'utf8');
await createShareGuide({ baseUrl, token, outputDir: directory, downloadBaseUrl });
await atomicJson(manifest, { id, enabled: true, updated_at: new Date().toISOString() });
console.log(JSON.stringify({ document_url: `${downloadBaseUrl}/researchwiki-install.md`, installer_url: `${downloadBaseUrl}/researchwiki-install.mjs` }, null, 2));
