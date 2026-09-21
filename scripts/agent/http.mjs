import path from 'node:path';
import { config, dataPath, repo } from '../common.mjs';
import { execute } from '../query/service.mjs';
import { readTokenAuth } from './auth.mjs';
import { agentSettings, createAgentHttpServer } from './http-server.mjs';
import { createRouter } from '../server/router.mjs';
import { registerAssetRoutes } from '../server/routes/assets.mjs';
import { HttpError } from '../server/errors.mjs';
import { installDownloads } from './install-downloads.mjs';
import { requestMetrics } from '../query/telemetry.mjs';
import { withRead, readGateStats } from '../query/store.mjs';

export function listenAgent() {
  const settings = agentSettings(config);
  if (!settings.enabled) return null;
  const assets = createRouter(); registerAssetRoutes(assets);
  const server = createAgentHttpServer({ settings, execute, sharedAdmission: true, authorize: readTokenAuth(dataPath('runtime', 'mcp-read-token')),
    health: async () => ({ database: await withRead(run => run('SELECT 1'), { timeoutMs: 500 }).then(() => true, () => false), gate: readGateStats(), ...requestMetrics() }),
    installHandler: installDownloads(path.join(repo, 'outputs/private')),
    assetHandler: async (req, res, url) => {
      const matched = assets.match(req.method, url.pathname);
      if (!matched) throw new HttpError(404, '原件不存在');
      return matched.handler({ req, res, url, params: matched.params });
    } });
  server.listen(settings.port, settings.host, () => console.log(`ResearchWiki Agent HTTP/MCP: ${settings.publicBaseUrl ?? `http://${settings.host}:${settings.port}`}/mcp (Bearer required)`));
  return server;
}
