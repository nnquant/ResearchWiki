import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { agentRequest } from './client.mjs';
import { createResearchMcp } from './mcp-server.mjs';
const server = createResearchMcp(agentRequest);
await server.connect(new StdioServerTransport());
process.on('SIGINT', async () => { await server.close(); process.exit(0); });
