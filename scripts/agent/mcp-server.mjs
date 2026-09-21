import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { agentTools } from './tools.mjs';

export function createResearchMcp(invoke) {
  const server = new Server({ name: 'researchwiki', version: '1.1.0' }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: agentTools }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    if (!agentTools.some(t => t.name === request.params.name)) return { isError: true, content: [{ type: 'text', text: 'UNKNOWN_OPERATION' }] };
    try {
      const result = await invoke(request.params.name.slice('research_'.length), request.params.arguments ?? {}, { signal: extra.signal });
      return { structuredContent: result, content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (e) { return { isError: true, content: [{ type: 'text', text: JSON.stringify({ code: e.data?.code ?? e.code ?? 'REQUEST_FAILED', error: e.status >= 500 ? '研究服务暂时不可用' : e.message,
      ...((e.retry_after ?? e.data?.retry_after) != null ? { retry_after: e.retry_after ?? e.data?.retry_after } : {}) }) }] }; }
  });
  return server;
}
