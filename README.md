# Website Data MCP Server

An MCP (Model Context Protocol) server that turns any website into a queryable knowledge base for AI agents using Gemini File Search.

## Core Services

This server provides **five core services** that work together to ingest, index, sync, search, and manage website content:

### 1. Ingestion Service (`packages/core/src/services/ingestion.ts`)
Initial website crawl and indexing. Discovers all pages via FireCrawl `/map`, batch scrapes content, stores metadata and markdown in Supabase, and prepares content for indexing. Creates the Gemini File Search store and website record.

**What it does:**
- Creates Gemini File Search store for the website
- Discovers all URLs via FireCrawl
- Batch scrapes all pages
- Stores content in Supabase with status `ready_for_indexing`
- Triggers indexing pipeline

**MCP Tool**: `site_ingest`

### 2. Indexing Service (`packages/core/src/services/indexing.ts`)
Uploads stored markdown content to Gemini File Search for semantic retrieval. This service is **in development** and does not automatically trigger. Content is stored and ready for indexing, but indexing must be manually triggered.

**What it does:**
- Reads pages with status `ready_for_indexing` from Supabase
- Uploads markdown content to Gemini File Search
- Updates page status to `active` after successful upload
- Handles retries without re-scraping (uses stored markdown)

**Status**: In the works - does not trigger automatically

### 3. Sync Service (`packages/core/src/services/sync.ts`)
Incremental updates and refresh of website content. Discovers new pages, refreshes stale content, and handles deletions using a safe threshold-based approach.

**What it does:**
- Re-runs FireCrawl `/map` to discover current URLs
- Categorizes URLs: NEW, CHANGED, UNCHANGED, MISSING
- Scrapes and indexes new/changed pages
- Uses content hashes to detect changes
- Safely handles deletions (requires 3 consecutive misses before deletion)

**MCP Tool**: `site_sync`

### 4. Search Service (`packages/core/src/services/search.ts`)
Semantic search queries using Gemini File Search. Ask questions, check for existing content, and find mentions of keywords across the indexed website.

**What it does:**
- Executes semantic queries using Gemini File Search
- Returns grounded answers with source citations
- Checks for existing content about topics
- Finds pages mentioning specific keywords

**MCP Tools**: `site_ask`, `site_check_existing_content`, `site_find_mentions`

### 5. Individual URL Service (`packages/core/src/services/individual-url.ts`)
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
# Install dependencies for all packages
pnpm install

# Build all packages
pnpm build
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
# Run MCP server (development)
pnpm mcp:dev

# Run Next.js web app (development)
pnpm web:dev

# Build for production
pnpm build

# Start production servers
pnpm mcp:start
pnpm web:start
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

This project uses a **monorepo architecture** with clear separation between core business logic and interface layers:

```
├── packages/
│   └── core/                    # Core business logic (framework-agnostic)
│       ├── src/
│       │   ├── services/        # Core services (ingestion, indexing, sync, search, etc.)
│       │   ├── clients/         # API clients (Supabase, FireCrawl, Gemini)
│       │   ├── types/           # TypeScript type definitions
│       │   ├── utils/           # Utilities (hashing, URL parsing, logging)
│       │   └── config.ts        # Configuration management
│       └── package.json
│
├── apps/
│   ├── mcp-server/              # MCP server interface layer
│   │   ├── src/
│   │   │   ├── index.ts         # MCP server entry point
│   │   │   └── tools/           # MCP tool definitions
│   │   └── package.json
│   │
│   └── web/                     # Next.js web interface
│       ├── app/                  # Next.js App Router
│       └── package.json
│
├── scripts/                      # Test scripts for core modules
│   ├── test-ingestion.ts        # Test ingestion service
│   ├── test-indexing.ts         # Test indexing service
│   ├── test-search.ts           # Test search service
│   ├── cleanup-gemini.ts        # Cleanup utility
│   └── list-websites.ts         # List websites utility
│
└── package.json                  # Root workspace configuration
```

### Architecture Philosophy

**Core Logic (`packages/core/`):**
- Framework-agnostic business logic
- Can be used by any interface (MCP, REST API, CLI, etc.)
- Fully testable independently
- No dependencies on interface layers

**Interface Layers (`apps/`):**
- Thin wrappers around core logic
- MCP server: Exposes core services via MCP protocol
- Next.js app: Provides web UI for core services
- Easy to add new interfaces (CLI, REST API, etc.)

## Testing Core Modules

The core business logic can be tested directly using test scripts, without needing to run the MCP server or web interface.

### Available Test Scripts

All test scripts are located in the `scripts/` directory and can be run from the project root:

#### 1. Test Ingestion Service

Tests the ingestion service directly - discovers URLs, scrapes content, and stores pages in the database.

```bash
pnpm test:ingestion <url> [displayName]
```

**Example:**
```bash
pnpm test:ingestion https://www.peersignal.org/ "PeerSignal"
```

**What it does:**
- Validates input (URL and optional display name)
- Creates Gemini File Search store
- Discovers all URLs via FireCrawl
- Batch scrapes all pages
- Stores pages in database with status `ready_for_indexing`
- Returns website ID for subsequent indexing

**Output:**
- Website ID
- Domain
- Gemini Store ID
- Pages discovered
- Pages scraped
- Errors (if any)

#### 2. Test Indexing Service

Tests the indexing service directly - uploads stored markdown content to Gemini File Search.

```bash
pnpm test:indexing <websiteId>
```

**Example:**
```bash
pnpm test:indexing a0001d33-25ee-41b5-b79a-0dbac05296fb
```

**Prerequisites:**
- Website must exist in database
- Website must have pages with status `ready_for_indexing`
- Pages must have `markdown_content`

**What it does:**
- Verifies website exists
- Checks for pages ready for indexing
- Uploads markdown content to Gemini File Search
- Updates page status to `active`
- Returns indexing results

#### 3. Test Search Service

Tests the search service directly - asks questions about website content using Gemini File Search.

```bash
pnpm test:search <question> <websiteDomain>
```

**Example:**
```bash
pnpm test:search "What is PeerSignal about?" "peersignal.org"
```

**Prerequisites:**
- Website must exist in database
- Website must have indexed pages (run indexing first)

**What it does:**
- Validates question and domain
- Executes semantic search query
- Returns answer with source citations

#### 4. List Websites

Lists all websites in the database with their details.

```bash
pnpm list:websites
```

**Output:**
- Website ID
- Domain
- Display name
- Gemini Store ID
- Created date

#### 5. Cleanup Gemini Stores

Cleans up Gemini File Search stores and documents.

```bash
# Full cleanup (delete stores and documents)
pnpm cleanup

# Partial cleanup (delete documents only, keep stores)
pnpm cleanup:docs
```

### Testing Workflow

**Complete testing workflow:**

```bash
# 1. Test ingestion
pnpm test:ingestion https://example.com "Example Website"
# Output: Website ID: abc123-def456-...

# 2. Test indexing (use website ID from step 1)
pnpm test:indexing abc123-def456-...

# 3. Test search (use domain from step 1)
pnpm test:search "What is this website about?" "example.com"
```

### Why Test Scripts?

- **Direct testing**: Test core logic without interface layers
- **Fast iteration**: No need to start servers or build apps
- **Isolated testing**: Test individual services independently
- **CLI-friendly**: Easy to use in CI/CD pipelines
- **Debugging**: Quick way to test changes to core modules

### Core Module Structure

Each core service in `packages/core/src/services/` is:
- **Self-contained**: All business logic in one place
- **Validated**: Input validation using Zod
- **Testable**: Can be imported and tested directly
- **Reusable**: Used by MCP server, web app, and test scripts

## License

MIT
