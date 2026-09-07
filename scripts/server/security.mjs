import { randomBytes } from 'node:crypto';
import { config } from '../common.mjs';
import { HttpError } from './errors.mjs';

/** Per-process CSRF token; the SPA reads it from /api/status and echoes it in x-wiki-token. */
export const csrfToken = randomBytes(24).toString('hex');

const allowedHosts = [`127.0.0.1:${config.port}`, `localhost:${config.port}`];
const allowedOrigins = allowedHosts.map(host => `http://${host}`);

const CSP = [
  "default-src 'self'",
  "img-src 'self' https: data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "script-src 'self'",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

export function securityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', CSP);
}

export function assertHost(req) {
  if (!allowedHosts.includes(req.headers.host)) throw new HttpError(403, '不接受此 Host');
}

export function assertOrigin(req) {
  const origin = req.headers.origin;
  if (origin && !allowedOrigins.includes(origin)) throw new HttpError(403, '不接受跨站请求');
}

export function assertCsrf(req) {
  if (req.headers['x-wiki-token'] !== csrfToken) throw new HttpError(403, '请从本机 Wiki 页面提交');
}

export const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export async function readBody(req, max = 1024 * 1024) {
  const parts = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, '请求体超过大小限制');
    parts.push(chunk);
  }
  return Buffer.concat(parts);
}

export async function readJson(req, max = 1024 * 1024) {
  const raw = await readBody(req, max);
  if (!raw.length) return {};
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, '请求体不是有效的 JSON');
  }
}
