# Website Data MCP Server

An MCP (Model Context Protocol) server that turns any website into a queryable knowledge base for AI agents using Gemini File Search.

## Core Services

This server provides **five core services** that work together to ingest, index, sync, search, and manage website content:

### 1. Ingestion Service (`src/services/ingestion.ts`)
Initial website crawl and indexing. Discovers all pages via FireCrawl `/map`, batch scrapes content, stores metadata and markdown in Supabase, and prepares content for indexing. Creates the Gemini File Search store and website record.

**What it does:**
- Creates Gemini File Search store for the website
- Discovers all URLs via FireCrawl
- Batch scrapes all pages
- Stores content in Supabase with status `ready_for_indexing`
- Triggers indexing pipeline

**MCP Tool**: `site_ingest`

### 2. Indexing Service (`src/services/indexing.ts`)
Uploads stored markdown content to Gemini File Search for semantic retrieval. This service is **in development** and does not automatically trigger. Content is stored and ready for indexing, but indexing must be manually triggered.

**What it does:**
- Reads pages with status `ready_for_indexing` from Supabase
- Uploads markdown content to Gemini File Search
- Updates page status to `active` after successful upload
- Handles retries without re-scraping (uses stored markdown)

**Status**: In the works - does not trigger automatically

### 3. Sync Service (`src/services/sync.ts`)
Incremental updates and refresh of website content. Discovers new pages, refreshes stale content, and handles deletions using a safe threshold-based approach.

**What it does:**
- Re-runs FireCrawl `/map` to discover current URLs
- Categorizes URLs: NEW, CHANGED, UNCHANGED, MISSING
- Scrapes and indexes new/changed pages
- Uses content hashes to detect changes
- Safely handles deletions (requires 3 consecutive misses before deletion)

**MCP Tool**: `site_sync`

### 4. Search Service (`src/services/search.ts`)
Semantic search queries using Gemini File Search. Ask questions, check for existing content, and find mentions of keywords across the indexed website.

**What it does:**
- Executes semantic queries using Gemini File Search
- Returns grounded answers with source citations
- Checks for existing content about topics
- Finds pages mentioning specific keywords

**MCP Tools**: `site_ask`, `site_check_existing_content`, `site_find_mentions`

### 5. Individual URL Service (`src/services/individual-url.ts`)
Single URL operations for existing websites. Handles indexing new URLs, checking status, and reindexing existing URLs. Similar to Google Search Console's "add individual URL" feature.

**What it does:**
- Indexes a single URL for an existing website
- Gets the status of a specific URL
- Re-scrapes and re-indexes an existing URL
- Validates URL belongs to the website's domain

**MCP Tools**: `site_reindex_url`, `site_get_url_status`

## Quick Start

### Prerequisites
- Node.js 20+
- Supabase project
- Gemini API key with File Search access
- FireCrawl API key

### Installation

```bash
npm install
npm run build
```

### Environment Variables

Create a `.env` file:

```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your-service-role-key
GEMINI_API_KEY=your-gemini-api-key
FIRECRAWL_API_KEY=your-firecrawl-api-key
GEMINI_MODEL=gemini-2.5-flash
```

### Database Setup

Run the migrations in `supabase/migrations/` against your Supabase database.

### Run

```bash
# Development
npm run dev

# Production
npm start
```

## MCP Tools

- **`site_ingest`** - Ingest a new website (Service 1: Ingestion)
- **`site_sync`** - Sync an existing website (Service 3: Sync)
- **`site_ask`** - Ask questions about website content (Service 4: Search)
- **`site_check_existing_content`** - Check if content already exists (Service 4: Search)
- **`site_find_mentions`** - Find pages mentioning keywords (Service 4: Search)
- **`site_reindex_url`** - Re-index a single URL (Service 5: Individual URL)
- **`site_get_url_status`** - Get status of a specific URL (Service 5: Individual URL)
- **`site_list`** - List all indexed websites

## Architecture

```
Website → FireCrawl → Supabase → Gemini File Search → AI Agents
```

1. **FireCrawl** discovers and scrapes website content
2. **Supabase** stores metadata, content hashes, and markdown (system of record)
3. **Gemini File Search** provides semantic search capabilities
4. **MCP Tools** expose clean interfaces for AI agents

## Project Structure

```
src/
├── index.ts              # MCP server entry point
├── clients/              # API clients (Supabase, FireCrawl, Gemini)
├── services/             # Core services
│   ├── ingestion.ts      # Service 1: Initial website ingestion
│   ├── indexing.ts       # Service 2: Upload to Gemini File Search
│   ├── sync.ts           # Service 3: Incremental sync
│   ├── search.ts          # Service 4: Semantic search
│   ├── individual-url.ts # Service 5: Single URL operations
│   └── cleanup.ts         # Utility service
├── tools/                # MCP tool definitions
└── utils/                # Utilities (hashing, URL parsing, logging)
```

## License

MIT
