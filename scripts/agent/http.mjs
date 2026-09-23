import path from 'node:path';
import { config, dataPath, repo } from '../common.mjs';
import { execute } from '../query/service.mjs';
import { readTokenAuth } from './auth.mjs';
import { agentSettings, createAgentHttpServer, createAgentHttpHandler } from './http-server.mjs';
import { allowedRequestHosts } from '../server/allowed-hosts.mjs';
import { createRouter } from '../server/router.mjs';
import { registerAssetRoutes } from '../server/routes/assets.mjs';
import { HttpError } from '../server/errors.mjs';
import { installDownloads } from './install-downloads.mjs';
import { requestMetrics } from '../query/telemetry.mjs';
import { withRead, readGateStats } from '../query/store.mjs';

function surfaceOptions(settings) {
  const assets = createRouter(); registerAssetRoutes(assets);
  return { settings, execute, sharedAdmission: true, authorize: readTokenAuth(dataPath('runtime', 'mcp-read-token')),
    health: async () => ({ database: await withRead(run => run('SELECT 1'), { timeoutMs: 500 }).then(() => true, () => false), gate: readGateStats(), ...requestMetrics() }),
    installHandler: installDownloads(path.join(repo, 'outputs/private')),
    assetHandler: async (req, res, url) => {
      const matched = assets.match(req.method, url.pathname);
      if (!matched) throw new HttpError(404, '原件不存在');
      return matched.handler({ req, res, url, params: matched.params });
    } };
}

export function createAgentGateway() {
  const settings = agentSettings(config);
  if (!settings.enabled) return null;
  settings.basePath = '/agent';
  // Public proxies may rewrite Host to the local Wiki port. Use an explicit
  // canonical gateway URL in that case; never trust arbitrary forwarded headers.
  settings.publicBaseUrl = config.agent?.gatewayBaseUrl || null;
  if (settings.publicBaseUrl) {
    const url = new URL(settings.publicBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.replace(/\/$/, '').endsWith('/agent')) throw new Error('agent.gatewayBaseUrl 必须是以 /agent 结尾、无凭据的 HTTP(S) 地址');
    settings.publicBaseUrl = url.href.replace(/\/$/, '');
    settings.wikiBaseUrl ??= settings.publicBaseUrl.slice(0, -'/agent'.length);
  }
  settings.allowedHosts = [...new Set([...allowedRequestHosts(config), ...(settings.publicBaseUrl ? [new URL(settings.publicBaseUrl).host] : [])])];
  settings.allowedOrigins = [...settings.allowedHosts.map(host => `http://${host}`), ...(settings.publicBaseUrl ? [new URL(settings.publicBaseUrl).origin] : [])];
  return createAgentHttpHandler(surfaceOptions(settings));
}

export function listenAgent() {
  const settings = agentSettings(config);
  if (!settings.enabled) return null;
  const server = createAgentHttpServer(surfaceOptions(settings));
  server.listen(settings.port, settings.host, () => console.log(`ResearchWiki Agent HTTP/MCP: ${settings.publicBaseUrl ?? `http://${settings.host}:${settings.port}`}/mcp (Bearer required)`));
  return server;
}
