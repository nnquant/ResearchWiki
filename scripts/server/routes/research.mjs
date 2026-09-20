import { dataPath } from '../../common.mjs';
import { readTokenAuth } from '../../agent/auth.mjs';
import { readJson } from '../security.mjs';
import { execute } from '../../query/service.mjs';
const authorized = readTokenAuth(dataPath('runtime', 'mcp-read-token'));
export async function isAgentReadRequest(req, pathname) {
  if (req.method !== 'POST' || !/^\/api\/research\/(describe|resolve|query|search|read|related|graph)$/.test(pathname)) return false;
  return authorized(req);
}
export function registerResearchRoutes(router) {
  for (const operation of ['describe', 'resolve', 'query', 'search', 'read', 'related', 'graph']) {
    router.route('POST', `/api/research/${operation}`, async ({ req, res }) => {
      const controller = new AbortController();
      const cancel = () => { if (!res.writableEnded) controller.abort(); };
      res.once('close', cancel);
      try { return await execute(operation, await readJson(req, 64 * 1024), { signal: controller.signal }); }
      finally { res.removeListener('close', cancel); }
    });
  }
}
