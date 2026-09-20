import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// Offline preparation from public official snapshots. No wiki content is sent out.
const directory = path.resolve(process.argv[2] ?? 'work/entity-sources');
const sources = [], entities = new Map();
async function read(name, url) {
  const bytes = await fs.readFile(path.join(directory, name));
  sources.push({ file: name, url, retrieved_at: new Date((await fs.stat(path.join(directory, name))).mtime).toISOString(), sha256: createHash('sha256').update(bytes).digest('hex') });
  return name.endsWith('.json') ? JSON.parse(bytes) : bytes.toString('utf8');
}
function add(item) {
  const prior = entities.get(item.entity_id);
  if (prior) { prior.aliases = [...new Set([...prior.aliases, item.name, ...item.aliases])]; return; }
  entities.set(item.entity_id, item);
}
function company(id, name, aliases, source, extra = {}) {
  add({ entity_id: id, type: 'company', name, aliases: [...new Set(aliases.filter(x => typeof x === 'string' && x.trim()))], source, ...extra });
}
function security(market, code, name, source, issuer_id, extra = {}) {
  const id = `entity:security:${market.toLowerCase()}:${code.toLowerCase().replace(/[^a-z0-9-]/g, '_')}`;
  add({ entity_id: id, type: 'security', name: `${market}:${code}`, aliases: [], market, code, security_name: name, source, ...(issuer_id ? { issuer_id } : {}), ...extra });
}
const secUrl = 'https://www.sec.gov/files/company_tickers_exchange.json';
const sec = await read('sec-tickers.json', secUrl);
if (sec.fields.join(',') !== 'cik,name,ticker,exchange') throw new Error('SEC schema changed');
for (const [cik, name, code, exchange] of sec.data) {
  const id = `entity:company:sec:${cik}`;
  company(id, name, [], secUrl, { external_ids: { cik: String(cik) } });
  if (['Nasdaq', 'NYSE', 'NYSE American', 'CBOE', 'OTC'].includes(exchange)) security('US', code, name, secUrl, id, { exchange });
}
const szUrl = 'https://www.szse.cn/api/report/ShowReport?SHOWTYPE=xlsx&CATALOGID=1110&TABKEY=tab1';
const sz = await read('szse-rows.json', szUrl);
await read('szse.xlsx', szUrl);
if (sz[0]?.B !== '公司全称' || sz[0]?.E !== 'A股代码') throw new Error('SZSE schema changed');
for (const row of sz.slice(1)) {
  if (!/^\d{6}$/.test(row.E)) continue;
  const id = `entity:company:szse:${row.E}`;
  company(id, row.B, [row.C, row.F], szUrl);
  security('SZ', row.E, row.F, szUrl, id);
  if (/^\d{6}$/.test(row.J)) security('SZ', row.J, row.K, szUrl, id);
}
const twUrl = 'https://openapi.twse.com.tw/v1/opendata/t187ap03_L';
const tw = await read('twse.json', twUrl);
if (!tw[0]?.公司代號 || !tw[0]?.公司名稱) throw new Error('TWSE schema changed');
for (const row of tw) {
  if (!/^\d{4}$/.test(row.公司代號)) continue;
  const id = `entity:company:twse:${row.公司代號}`;
  company(id, row.公司名稱, [row.公司簡稱, row.英文簡稱], twUrl);
  security('TW', row.公司代號, row.公司簡稱, twUrl, id);
}
const shUrl = 'https://www.sse.com.cn/js/common/ssesuggestdata.js';
const sh = await read('sse-suggest.js', shUrl);
let shCount = 0;
// Parse data literals, never execute downloaded JavaScript. Only ordinary-equity code families.
for (const match of sh.matchAll(/_t\.push\(\{val:"(6(?:00|01|03|05|88|89)\d{3})",val2:"([^"\\]+)"/g)) {
  const [, code, name] = match, id = `entity:company:sse:${code}`;
  company(id, name, [], shUrl, { identity_basis: 'listed_equity_short_name' });
  security('SH', code, name, shUrl, id); shCount++;
}
if (shCount < 1000) throw new Error('SSE snapshot incomplete or schema changed');
const hkUrl = 'https://www.hkex.com.hk/eng/services/trading/securities/securitieslists/ListOfSecurities.xlsx';
const hk = await read('hkex-rows.json', hkUrl);
await read('hkex.xlsx', hkUrl);
if (hk[2]?.A !== 'Stock Code' || hk[2]?.C !== 'Category') throw new Error('HKEX schema changed');
for (const row of hk.slice(3)) {
  if (row.C !== 'Equity' || !/^\d{5}$/.test(row.A)) continue;
  // Security short names are not sufficient to infer the legal issuer or dual-counter identity.
  security('HK', row.A, row.B, hkUrl, null, { isin: row.F, source_as_of: hk[1].A });
}
const result = { version: 1, prepared_at: new Date().toISOString(), sources, entities: [...entities.values()] };
await fs.writeFile('config/entity-masterdata.json', JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ entities: entities.size, sources: sources.length, companies: result.entities.filter(e => e.type === 'company').length }));
