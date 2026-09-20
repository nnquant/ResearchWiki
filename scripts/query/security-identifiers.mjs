// Finite, market-qualified spelling variants only; never infer a market from a bare code.
export function securityAliases(item) {
  const { market, code, exchange } = item;
  if (typeof code !== 'string') return [];
  if (market === 'HK' && /^\d{5}$/.test(code)) {
    const codes = [...new Set([code, String(Number(code)), String(Number(code)).padStart(4, '0')])];
    return codes.flatMap(c => [`HK:${c}`, `${c}.HK`, `${c} HK`, `${c}HK`]);
  }
  const suffixes = market === 'SH' ? ['SH', 'SS'] : market === 'SZ' ? ['SZ'] : market === 'TW' ? ['TW', 'TT'] : [];
  if (suffixes.length && (market === 'TW' ? /^\d{4}$/ : /^\d{6}$/).test(code))
    return [`${market}:${code}`, ...suffixes.flatMap(s => [`${code}.${s}`, `${code} ${s}`, `${code}${s}`])];
  if (market === 'US' && /^[A-Z][A-Z0-9.-]{0,12}$/.test(code)) {
    const suffixes = ['US', ...(exchange === 'Nasdaq' ? ['O', 'OQ'] : exchange === 'NYSE' ? ['N'] : [])];
    return [`US:${code}`, ...suffixes.flatMap(s => [`${code}.${s}`, `${code} ${s}`])];
  }
  return [];
}

export function securityKey(value) {
  const name = value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
  const prefix = name.match(/^(US|HK|SH|SZ|TW):([A-Z0-9.-]+)$/);
  if (prefix) {
    const [, market, code] = prefix;
    if (market === 'US') return /^[A-Z][A-Z0-9.-]{0,12}$/.test(code) ? { market, code } : null;
    const valid = market === 'HK' ? /^\d{1,5}$/ : market === 'TW' ? /^\d{4}$/ : /^\d{6}$/;
    return valid.test(code) ? { market, code: market === 'HK' ? code.padStart(5, '0') : code } : null;
  }
  const numeric = name.match(/^(\d{1,6})(?:[.\s-]+)?(HK|SH|SS|SZ|TW|TT|CH)$/);
  if (numeric) {
    const [, code, suffix] = numeric, market = { SS: 'SH', TT: 'TW', CH: 'CN' }[suffix] ?? suffix;
    if (market === 'HK' && code.length <= 5) return { market, code: code.padStart(5, '0') };
    if ((['SH', 'SZ', 'CN'].includes(market) && code.length === 6) || (market === 'TW' && code.length === 4)) return { market, code };
    return null;
  }
  const us = name.match(/^([A-Z][A-Z0-9.-]{0,12})[.\s-]+(US|O|OQ|N)$/);
  return us ? { market: 'US', code: us[1], exchange: ['O', 'OQ'].includes(us[2]) ? 'Nasdaq' : us[2] === 'N' ? 'NYSE' : null } : null;
}
