import { normalizeEntityName as norm, compileRegistry } from './entities.mjs';
import { securityKey, securityAliases } from './security-identifiers.mjs';
export { securityKey } from './security-identifiers.mjs';

// Only typographic punctuation/spacing. Do not remove legal suffixes, countries,
// divisions, hyphens or parenthetical business qualifiers from company identities.
export const companyFormatKey = name => norm(name).replace(/[.,，。\s]/g, '');
const legalStem = name => companyFormatKey(name).replace(/(?:incorporated|corporation|companylimited|company|colimited|coltd|limited|corp|inc|ltd|plc)+$/i, '');
const put = (map, key, id) => { const ids = map.get(key) ?? new Set(); ids.add(id); map.set(key, ids); };

export function reconcileNames(names, current, master, reviewed) {
  compileRegistry(current);
  const pool = new Map(master.entities.map(e => [e.entity_id, structuredClone(e)]));
  const redirects = new Map(), decisions = [], approved = new Map(current.entities.map(e => [e.entity_id, structuredClone(e)]));
  for (const seed of reviewed.entities) {
    const item = structuredClone(seed);
    for (const id of item.master_ids ?? []) {
      const source = pool.get(id);
      if (!source || source.type !== item.type) throw new Error(`Invalid reviewed crosswalk: ${id}`);
      redirects.set(id, item.entity_id);
      item.aliases.push(source.name, ...source.aliases);
    }
    const original = approved.get(item.entity_id);
    if (original) {
      item.aliases.push(original.name, ...original.aliases);
      if (original.alias_evidence) item.alias_evidence = [...original.alias_evidence, ...item.alias_evidence ?? []];
    }
    item.aliases = [...new Set(item.aliases)].filter(alias => norm(alias) !== norm(item.name));
    approved.set(item.entity_id, item);
  }
  for (const [id, item] of approved) pool.set(id, item);
  for (const [id] of redirects) if (redirects.get(id) !== id) pool.delete(id);
  for (const item of pool.values()) if (item.issuer_id) item.issuer_id = redirects.get(item.issuer_id) ?? item.issuer_id;
  const exact = new Map(), formatted = new Map(), securities = new Map(), bareCodes = new Map(), weak = new Map();
  const reviewedNames = new Set(reviewed.entities.flatMap(e => [e.name, ...e.aliases].map(n => `${e.type}:${norm(n)}`)));
  for (const item of pool.values()) {
    const derivedAliases = new Set((item.alias_evidence ?? []).map(e => norm(e.alias)));
    for (const name of [item.name, ...item.aliases, ...(item.type === 'security' ? securityAliases(item) : [])]) {
      put(exact, `${item.type}:${norm(name)}`, item.entity_id);
      // Previously inferred aliases remain exact mappings, never new inference seeds.
      if (item.type === 'company' && !derivedAliases.has(norm(name))) {
        put(formatted, companyFormatKey(name), item.entity_id);
        // Candidate generation only. Suffix stripping must never approve identity.
        put(weak, legalStem(name), item.entity_id);
      }
    }
    if (item.type === 'security') { put(securities, `${item.market}:${item.code}`, item.entity_id); put(bareCodes, norm(item.code), item.entity_id); }
  }
  const lookupSecurity = text => {
    const key = securityKey(text); if (!key) return [];
    const markets = key.market === 'CN' ? ['SH', 'SZ'] : [key.market];
    return [...new Set(markets.flatMap(market => [...securities.get(`${market}:${key.code}`) ?? []]))]
      .filter(id => !key.exchange || pool.get(id).exchange === key.exchange);
  };
  function include(id, raw, basis) {
    let item = approved.get(id);
    if (!item) {
      item = structuredClone(pool.get(id));
      if (item.type === 'company') item.aliases = item.aliases.filter(alias => !/^[a-z]{1,3}$/i.test(norm(alias)) ||
        reviewedNames.has(`company:${norm(alias)}`) || exact.get(`company:${norm(alias)}`)?.size > 1);
      approved.set(id, item);
    }
    if (raw && norm(raw) !== norm(item.name) && !item.aliases.some(a => norm(a) === norm(raw))) {
      item.aliases.push(raw);
      (item.alias_evidence ??= []).push({ alias: raw, basis, source: item.source });
    }
    if (item.issuer_id && !approved.has(item.issuer_id)) include(item.issuer_id, null, 'issuer');
  }
  for (const row of names) {
    const type = row.entity_type, name = row.normalized_name;
    let candidates = [...exact.get(`${type}:${norm(name)}`) ?? []], basis = 'exact_official_or_reviewed_name';
    if (!candidates.length && type === 'security') { candidates = lookupSecurity(name); basis = 'explicit_market_and_official_code'; }
    if (!candidates.length && type === 'company') {
      candidates = [...formatted.get(companyFormatKey(name)) ?? []]; basis = 'typographic_variant';
      const bracket = norm(name).match(/^(.+?)\s*\(([^()]+)\)$/);
      if (bracket && !candidates.length) {
        const exactBase = [...formatted.get(companyFormatKey(bracket[1])) ?? []];
        const base = exactBase.length ? exactBase : [...weak.get(legalStem(bracket[1])) ?? []];
        let securities = lookupSecurity(bracket[2]);
        // A bare code is usable only with an independently matching issuer name.
        // It is never registered as a standalone security alias here.
        if (!securities.length && /^[a-z0-9.-]{1,12}$/i.test(bracket[2]) && !securityKey(bracket[2])) securities = [...bareCodes.get(bracket[2]) ?? []];
        // Both the issuer name and explicit market/code must agree.
        candidates = base.filter(id => securities.some(s => pool.get(s).issuer_id === id));
        basis = 'issuer_name_and_market_code_agree';
        if (!candidates.length && (base.length || securities.length)) {
          decisions.push({ ...row, action: 'review', reason: 'name_code_not_confirmed', candidates: [...new Set([...base, ...securities.map(s => pool.get(s).issuer_id).filter(Boolean)])] }); continue;
        }
      }
    }
    if (candidates.length === 1) {
      if (type === 'company' && /^[a-z]{1,3}$/i.test(name) && !reviewedNames.has(`${type}:${norm(name)}`)) {
        decisions.push({ ...row, action: 'review', reason: 'short_acronym_requires_context', candidates }); continue;
      }
      include(candidates[0], name, basis);
      decisions.push({ ...row, action: 'mapped', reason: basis, entity_id: candidates[0] });
    } else if (candidates.length > 1) {
      // Retain all identities for exact ambiguous aliases so runtime resolution is explicit.
      if (basis === 'exact_official_or_reviewed_name') for (const id of candidates) include(id, null, basis);
      decisions.push({ ...row, action: 'review', reason: 'multiple_identities', candidates });
    } else {
      const key = legalStem(name);
      const proposed = type === 'company' ? [...weak.get(key) ?? []].slice(0, 10) : [];
      const reason = proposed.length ? 'possible_legal_suffix_variant' : type === 'security' && !securityKey(name) ? 'market_missing_or_unsupported' : /[�\u0000-\u001f]/.test(name) ? 'damaged_text' : /[;/、]/.test(name) ? 'compound_or_qualified_name' : 'no_verified_mapping';
      decisions.push({ ...row, action: 'review', reason, candidates: proposed });
    }
  }
  const proposal = { ...current, version: 1, entities: [...approved.values()].sort((a, b) => a.entity_id.localeCompare(b.entity_id)) };
  const compiled = compileRegistry(proposal);
  for (const row of decisions) {
    const ids = [...compiled.aliases.get(`${row.entity_type}:${norm(row.normalized_name)}`) ?? []];
    if (row.action === 'mapped' ? ids.length !== 1 || ids[0] !== row.entity_id : ids.length === 1) {
      throw new Error(`Proposal conflicts with review decision: ${row.entity_type}:${row.normalized_name}`);
    }
  }
  return { proposal, decisions, summary: { names: names.length, mapped_names: decisions.filter(d => d.action === 'mapped').length,
    review_names: decisions.filter(d => d.action === 'review').length, registry_entities: proposal.entities.length,
    ambiguous_aliases: [...compiled.aliases.values()].filter(ids => ids.size > 1).length } };
}
