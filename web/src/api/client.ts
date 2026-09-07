import type { Status } from './types';

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown>;
  constructor(status: number, message: string, data: Record<string, unknown> = {}) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

let csrfToken: string | null = null;
let statusPromise: Promise<Status> | null = null;

async function fetchStatus(): Promise<Status> {
  const res = await fetch('/api/status', { headers: { accept: 'application/json' } });
  if (!res.ok) throw new ApiError(res.status, '无法连接 Wiki 服务');
  const status = (await res.json()) as Status;
  csrfToken = status.csrf;
  return status;
}

/** Status is fetched once eagerly so mutating calls have a CSRF token ready. */
export function loadStatus(): Promise<Status> {
  if (!statusPromise) statusPromise = fetchStatus().catch(e => { statusPromise = null; throw e; });
  return statusPromise;
}

export function refreshStatus(): Promise<Status> {
  statusPromise = null;
  return loadStatus();
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  rawBody?: BodyInit;
  signal?: AbortSignal;
}

async function parseError(res: Response): Promise<ApiError> {
  let payload: Record<string, unknown> = {};
  try { payload = await res.json(); } catch { /* not JSON */ }
  const message = typeof payload.error === 'string' ? payload.error : `请求失败 (${res.status})`;
  return new ApiError(res.status, message, payload);
}

export async function api<T>(path: string, { method = 'GET', body, rawBody, signal }: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  if (method !== 'GET') {
    if (!csrfToken) await loadStatus();
    headers['x-wiki-token'] = csrfToken ?? '';
  }
  let payload: BodyInit | undefined;
  if (rawBody !== undefined) {
    payload = rawBody;
    headers['content-type'] = 'application/octet-stream';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(path, { method, headers, body: payload, signal });
  if (res.status === 403 && method !== 'GET' && csrfToken) {
    // Server restarted → new token. Refresh once and retry.
    await refreshStatus();
    headers['x-wiki-token'] = csrfToken ?? '';
    const retry = await fetch(path, { method, headers, body: payload, signal });
    if (!retry.ok) throw await parseError(retry);
    return retry.json() as Promise<T>;
  }
  if (!res.ok) throw await parseError(res);
  return res.json() as Promise<T>;
}

export function encodeSlug(slug: string): string {
  return slug.split('/').map(encodeURIComponent).join('/');
}

export function pageUrl(slug: string): string {
  return `/page/${encodeSlug(slug)}`;
}

export function editUrl(slug: string): string {
  return `/edit/${encodeSlug(slug)}`;
}

export function graphUrl(slug: string): string {
  return `/graph/${encodeSlug(slug)}`;
}
