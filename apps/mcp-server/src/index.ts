#!/usr/bin/env node
/**
 * Website Data MCP Server
 *
 * An MCP server that ingests websites via FireCrawl,
 * tracks state in Supabase, uses Gemini File Search for semantic retrieval,
 * and exposes clean tools for AI agents.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import { toolDefinitions, handleToolCall } from './tools/index.js';
import { logger } from '../../../packages/core/src/utils/logger.js';

const log = logger.child({ context: 'server' });

// Create server instance
const server = new Server(
  {
    name: 'website-data-mcp-server',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Handle list tools request
server.setRequestHandler(ListToolsRequestSchema, async () => {
  log.info('Listing tools');
  return {
    tools: toolDefinitions,
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  log.info({ tool: name }, 'Tool call request');

  const result = await handleToolCall(name, args ?? {});

  return result;
});

// Error handling
server.onerror = (error) => {
  log.error({ error }, 'Server error');
};

process.on('SIGINT', async () => {
  log.info('Shutting down server');
  await server.close();
  process.exit(0);
});

// Start server
async function main() {
  log.info('Starting Website Data MCP Server');

  const transport = new StdioServerTransport();
  await server.connect(transport);

  log.info('Server connected via stdio');
}

main().catch((error) => {
  log.error({ error }, 'Failed to start server');
  process.exit(1);
});
