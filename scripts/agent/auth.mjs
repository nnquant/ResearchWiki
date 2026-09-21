import fs from 'node:fs/promises';
import { timingSafeEqual } from 'node:crypto';

export function readTokenAuth(tokenFile) {
  let cached;
  return async req => {
    const supplied = req.headers.authorization;
    if (typeof supplied !== 'string' || !supplied.startsWith('Bearer ')) return false;
    try {
      const stat = await fs.stat(tokenFile), key = `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      if (cached?.key !== key) cached = { key, token: Buffer.from((await fs.readFile(tokenFile, 'utf8')).trim()) };
      const expected = cached.token;
      const actual = Buffer.from(supplied.slice(7));
      return expected.length > 0 && actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch { return false; }
  };
}
