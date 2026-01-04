/**
 * MCP Tool definitions and handlers
 * 
 * This is the MCP interface layer - it calls core business logic
 * from @website-data/core package.
 */

import { z } from 'zod';
// Import from core package - these resolve at runtime via package exports
// TypeScript compilation uses relative paths for type checking
import * as ingestion from '../../../../packages/core/src/services/ingestion.js';
import * as search from '../../../../packages/core/src/services/search.js';
import * as individualUrl from '../../../../packages/core/src/services/individual-url.js';
import * as sync from '../../../../packages/core/src/services/sync.js';
import { loggers } from '../../../../packages/core/src/utils/logger.js';

const log = loggers.mcp;

// ============================================================================
// Tool Schemas (using Zod for validation)
// ============================================================================

export const SiteAskSchema = z.object({
  question: z.string().describe('The question to ask about the website content'),
  websiteDomain: z.string().describe('Website domain (e.g., "example.com" or "https://www.example.com")'),
});

export const SiteCheckSchema = z.object({
  query: z.string().describe('Topic or draft title to check for existing content'),
  websiteDomain: z.string().describe('Website domain (e.g., "example.com" or "https://www.example.com")'),
});

export const SiteStatusSchema = z.object({
  url: z.string().describe('The URL to check status for'),
});

export const SiteReindexSchema = z.object({
  url: z.string().describe('The URL to reindex'),
});

export const SiteIngestSchema = z.object({
  seedUrl: z.string().describe('The homepage or starting URL to ingest'),
  displayName: z.string().optional().describe('Human-readable name for the website'),
});

export const SiteSyncSchema = z.object({
  websiteId: z.string().describe('The website ID to sync'),
});

export const SiteListSchema = z.object({});

export const SiteSearchSchema = z.object({
  keywords: z.array(z.string()).describe('Keywords to search for'),
  websiteDomain: z.string().describe('Website domain (e.g., "example.com" or "https://www.example.com")'),
});

// ============================================================================
// Tool Definitions (for MCP registration)
// ============================================================================

export const toolDefinitions = [
  {
    name: 'site_ask',
    description:
      'Ask a question and get an answer grounded only in the indexed website content. Returns an answer with source citations.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        question: {
          type: 'string',
          description: 'The question to ask about the website content',
        },
        websiteDomain: {
          type: 'string',
          description: 'Website domain (e.g., "example.com" or "https://www.example.com"). Can be a full URL or just the domain.',
        },
      },
      required: ['question', 'websiteDomain'],
    },
  },
  {
    name: 'site_check_existing_content',
    description:
      'Check if the website already has content about a topic. Useful for marketing teams to avoid duplicate content. Example: "Have we already written a blog about X?"',
    inputSchema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Topic or draft title to check for existing content',
        },
        websiteDomain: {
          type: 'string',
          description: 'Website domain (e.g., "example.com" or "https://www.example.com")',
        },
      },
      required: ['query', 'websiteDomain'],
    },
  },
  {
    name: 'site_get_url_status',
    description:
      'Get the indexing status of a specific URL. Returns status (active/pending/error/deleted), last scraped time, and content hash.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to check status for',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'site_reindex_url',
    description:
      'Force re-scrape and re-index a specific URL. Use this to update content that has changed.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to reindex',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'site_ingest',
    description:
      'Ingest a new website starting from a seed URL. Discovers all pages, scrapes content, and indexes for semantic search.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        seedUrl: {
          type: 'string',
          description: 'The homepage or starting URL to ingest',
        },
        displayName: {
          type: 'string',
          description: 'Human-readable name for the website',
        },
      },
      required: ['seedUrl'],
    },
  },
  {
    name: 'site_sync',
    description:
      'Perform incremental sync for a website. Discovers new pages, refreshes stale content, and handles deletions.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        websiteId: {
          type: 'string',
          description: 'The website ID to sync',
        },
      },
      required: ['websiteId'],
    },
  },
  {
    name: 'site_list',
    description: 'List all indexed websites with their page counts and last sync times.',
    inputSchema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'site_find_mentions',
    description:
      'Find pages that mention specific keywords or products. Returns relevant pages with context.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keywords to search for',
        },
        websiteDomain: {
          type: 'string',
          description: 'Website domain (e.g., "example.com" or "https://www.example.com")',
        },
      },
      required: ['keywords', 'websiteDomain'],
    },
  },
];

// ============================================================================
// Tool Handlers
// ============================================================================

export async function handleToolCall(
  name: string,
  args: Record<string, unknown>
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  log.info({ tool: name, args }, 'Tool call received');

  try {
    let result: unknown;

    switch (name) {
      case 'site_ask': {
        const parsed = SiteAskSchema.parse(args);
        const response = await search.askQuestion(parsed.question, parsed.websiteDomain);
        result = {
          answer: response.answer,
          sources: response.sources,
          websiteId: response.websiteId,
        };
        break;
      }

      case 'site_check_existing_content': {
        const parsed = SiteCheckSchema.parse(args);
        const response = await search.checkExistingContent(parsed.query, parsed.websiteDomain);
        result = {
          hasExistingContent: response.hasExistingContent,
          answer: response.answer,
          relevantPages: response.relevantPages,
        };
        break;
      }

      case 'site_get_url_status': {
        const parsed = SiteStatusSchema.parse(args);
        const response = await individualUrl.getUrlStatus(parsed.url);
        result = response;
        break;
      }

      case 'site_reindex_url': {
        const parsed = SiteReindexSchema.parse(args);
        const response = await individualUrl.reindexUrl(parsed.url);
        result = response;
        break;
      }

      case 'site_ingest': {
        const parsed = SiteIngestSchema.parse(args);
        const response = await ingestion.ingestWebsite(parsed.seedUrl, parsed.displayName);
        result = {
          websiteId: response.websiteId,
          domain: response.domain,
          pagesDiscovered: response.pagesDiscovered,
          pagesIndexed: response.pagesIndexed,
          errorCount: response.errors.length,
        };
        break;
      }

      case 'site_sync': {
        const parsed = SiteSyncSchema.parse(args);
        const response = await sync.syncWebsite(parsed.websiteId);
        result = {
          syncLogId: response.syncLogId,
          urlsDiscovered: response.urlsDiscovered,
          urlsUpdated: response.urlsUpdated,
          urlsDeleted: response.urlsDeleted,
          errorCount: response.urlsErrored,
        };
        break;
      }

      case 'site_list': {
        const response = await ingestion.listWebsites();
        result = { websites: response };
        break;
      }

      case 'site_find_mentions': {
        const parsed = SiteSearchSchema.parse(args);
        const response = await search.findMentions(parsed.keywords, parsed.websiteDomain);
        result = {
          answer: response.answer,
          pages: response.pages,
        };
        break;
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    log.info({ tool: name }, 'Tool call completed');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ tool: name, error: message }, 'Tool call failed');

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({ error: message }),
        },
      ],
    };
  }
}
