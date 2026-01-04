# Website Data Indexing Core Modules

A collection of framework-agnostic core modules for ingesting, indexing, syncing, and searching website content using FireCrawl, Supabase, and Gemini File Search. These modules can be used by any interface layer—currently exposed via an MCP server and a Next.js web application, with CLI testing tools for direct module testing.

## What This Is

This is **not just an MCP server**—it's a modular system of core business logic that can be consumed by any interface:

- **Core Modules** (`packages/core/src/services/`): Framework-agnostic business logic for website data operations
- **Interface Layers** (`apps/`): Thin wrappers that expose core modules via different protocols
  - **MCP Server** (`apps/mcp-server/`): Exposes core modules via Model Context Protocol for AI agents
  - **Next.js App** (`apps/web/`): Provides a web UI for managing and testing core modules
- **Testing Layer** (`scripts/`): CLI tools for directly testing core modules without running servers

## Core Modules

### 1. Ingestion Module (`packages/core/src/services/ingestion.ts`)

**Purpose**: Initial website crawl and content discovery. Discovers all pages on a website, scrapes their content, and stores it in the database ready for indexing.

**Workflow**: Takes a seed URL and optional display name. Creates a Gemini File Search store, discovers all URLs via FireCrawl's `/map` endpoint, batch scrapes all pages using FireCrawl's batch API, validates and stores complete markdown content in Supabase with status `ready_for_indexing`, and creates a website record. Discards incomplete scrapes (missing markdown, empty content) to ensure data quality.

**Input**: `seedUrl` (string), `displayName` (optional string)

**Processing**: FireCrawl URL discovery → Batch scraping → Content validation → Database storage

**Output**: Returns `IngestionResult` with website ID, domain, Gemini store ID, pages discovered count, pages scraped count, and any errors encountered.

### 2. Indexing Module (`packages/core/src/services/indexing.ts`)

**Purpose**: Uploads stored markdown content to Gemini File Search for semantic search. Separated from ingestion to allow retries without re-scraping.

**Workflow**: Takes a website ID and optional job metadata. Reads all pages with status `ready_for_indexing` from Supabase, ensures the Gemini File Search store exists (creates if needed), uploads markdown content to Gemini File Search as documents, updates page status to `active` after successful upload, and stores Gemini file IDs for future reference. Handles retries gracefully using stored markdown.

**Input**: `websiteId` (string), `options` (optional: `ingestionJobId`, `syncJobId`, `autoCreateStore`)

**Processing**: Database query → Gemini store verification → Markdown upload → Status updates

**Output**: Returns `IndexingResult` with indexing job ID, website ID, pages indexed count, and any errors encountered.

### 3. Sync Module (`packages/core/src/services/sync.ts`)

**Purpose**: Incremental updates and refresh of website content. Discovers new pages, detects changed content, and safely handles deletions using a threshold-based approach.

**Workflow**: Takes a website ID. Re-runs FireCrawl `/map` to get current URLs, compares with existing database records to categorize URLs (NEW, CHANGED, UNCHANGED, MISSING), scrapes new and changed pages, uses content hashes to detect changes, updates unchanged pages with fresh timestamps, increments missing count for URLs not found, and only deletes URLs after 3 consecutive misses (prevents false deletions from temporary issues). Automatically triggers indexing for new/changed pages.

**Input**: `websiteId` (string)

**Processing**: URL discovery → Categorization → Change detection → Selective scraping → Safe deletion → Indexing trigger

**Output**: Returns `SyncResult` with sync job ID, URLs discovered, URLs updated, URLs deleted, and any errors encountered.

### 4. Search Module (`packages/core/src/services/search.ts`)

**Purpose**: Semantic search queries using Gemini File Search. Ask questions, check for existing content, and find keyword mentions across indexed websites.

**Workflow**: Takes a question and website domain. Validates and normalizes the domain input, looks up the website by base domain (handles www vs non-www), verifies the website has a Gemini File Search store, executes semantic query using Gemini File Search API, generates grounded answers with source citations, and returns formatted results with answer text and source URLs.

**Input**: `question` (string), `websiteDomain` (string - can be URL, domain, or domain with path)

**Processing**: Input validation → Domain normalization → Website lookup → Gemini File Search query → Answer generation

**Output**: Returns `SearchResult` with answer text, source citations (URLs, titles, snippets), and metadata.

### 5. Individual URL Module (`packages/core/src/services/individual-url.ts`)

**Purpose**: Single URL operations for existing websites. Handles indexing new URLs, checking status, and reindexing existing URLs—similar to Google Search Console's "add individual URL" feature.

**Workflow**: Takes a website ID and URL. Validates the URL belongs to the website's exact domain, verifies the website has existing pages (requirement for individual URL operations), scrapes the URL using FireCrawl's direct scrape API, validates content completeness, stores the page in database with status `processing`, triggers indexing for the single URL, and updates status to `active` after successful indexing. Also provides status checking and reindexing functions.

**Input**: `websiteId` (string), `url` (string)

**Processing**: Domain validation → URL scraping → Content validation → Database storage → Indexing trigger

**Output**: Returns `IndividualUrlResult` with success status, website ID, URL, current status, and any error messages.

### 6. Cleanup Module (`packages/core/src/services/cleanup.ts`)

**Purpose**: Utility module for cleaning up Gemini File Search stores and documents. Useful for testing, resetting, or removing old data.

**Workflow**: Takes cleanup options (delete stores flag, store filter pattern). Lists all Gemini File Search stores (optionally filtered), deletes all documents from each store, optionally deletes the stores themselves, handles rate limiting and retries with exponential backoff, and provides detailed cleanup reports.

**Input**: `options` (object: `deleteStores` boolean, `storeFilter` optional string pattern)

**Processing**: Store enumeration → Document deletion → Optional store deletion → Error handling

**Output**: Returns `CleanupResult` with stores deleted count, documents deleted count, per-store details, and any errors encountered.

## Testing Core Modules

Each core module can be tested directly using CLI tools in the `scripts/` directory. These tools provide a command-line interface for testing modules without running the MCP server or web application.

### Test Ingestion Module

**Command**: `pnpm test:ingestion <url> [displayName]`

**Example**:
```bash
pnpm test:ingestion https://www.peersignal.org/ "PeerSignal"
```

**What it does**: Validates the input URL and optional display name, calls the ingestion module to create a Gemini File Search store, discovers all URLs via FireCrawl, batch scrapes all pages, stores pages in the database with status `ready_for_indexing`, and outputs the website ID, domain, Gemini store ID, pages discovered count, pages scraped count, and any errors.

**Output**: Website ID (for use in subsequent indexing), domain, Gemini Store ID, pages discovered, pages scraped, and error list.

### Test Indexing Module

**Command**: `pnpm test:indexing <websiteId>`

**Example**:
```bash
pnpm test:indexing a0001d33-25ee-41b5-b79a-0dbac05296fb
```

**Prerequisites**: Website must exist in database and have pages with status `ready_for_indexing` and `markdown_content`.

**What it does**: Verifies the website exists in the database, checks for pages ready for indexing, calls the indexing module to upload markdown content to Gemini File Search, updates page status to `active` after successful upload, and outputs the indexing job ID, pages indexed count, and any errors.

**Output**: Indexing job ID, website ID, pages indexed count, and error list.

### Test Search Module

**Command**: `pnpm test:search <question> <websiteDomain>`

**Example**:
```bash
pnpm test:search "What is PeerSignal about?" "peersignal.org"
```

**Prerequisites**: Website must exist in database and have indexed pages (run indexing first).

**What it does**: Validates the question and website domain input, calls the search module to execute a semantic query using Gemini File Search, formats and displays the answer with source citations, and outputs the answer text, source URLs, titles, and snippets.

**Output**: Answer text, source citations (URLs, titles, snippets), and metadata.

### List Websites

**Command**: `pnpm list:websites`

**What it does**: Queries the database for all websites, formats and displays website details, and outputs website IDs for use in other test commands.

**Output**: Website ID, domain, display name, Gemini Store ID, and created date for each website.

### Cleanup Gemini Stores

**Commands**: 
- `pnpm cleanup` - Full cleanup (delete stores and documents)
- `pnpm cleanup:docs` - Partial cleanup (delete documents only, keep stores)

**What it does**: Calls the cleanup module to enumerate all Gemini File Search stores, deletes all documents from each store, optionally deletes the stores themselves (full cleanup mode), handles rate limiting and retries, and outputs cleanup statistics including stores processed, stores deleted, documents deleted, and any errors.

**Output**: Stores processed count, stores deleted count, documents deleted count, per-store details, and error list.

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

### Running Interface Layers

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

## Architecture

```
Website → FireCrawl → Supabase → Gemini File Search → AI Agents
```

1. **FireCrawl** discovers and scrapes website content
2. **Supabase** stores metadata, content hashes, and markdown (system of record)
3. **Gemini File Search** provides semantic search capabilities
4. **Interface Layers** (MCP, Next.js, CLI) expose core modules to different consumers

## Project Structure

This project uses a **monorepo architecture** with clear separation between core business logic and interface layers:

```
├── packages/
│   └── core/                    # Core business logic (framework-agnostic)
│       ├── src/
│       │   ├── services/        # Core modules (ingestion, indexing, sync, search, etc.)
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
│   │   │   └── tools/           # MCP tool definitions (wrappers around core modules)
│   │   └── package.json
│   │
│   └── web/                     # Next.js web interface
│       ├── app/                  # Next.js App Router
│       └── package.json
│
├── scripts/                      # CLI testing tools for core modules
│   ├── test-ingestion.ts        # Test ingestion module
│   ├── test-indexing.ts         # Test indexing module
│   ├── test-search.ts           # Test search module
│   ├── cleanup-gemini.ts        # Test cleanup module
│   └── list-websites.ts         # Utility to list websites
│
└── package.json                  # Root workspace configuration
```

### Architecture Philosophy

**Core Modules (`packages/core/`):**
- Framework-agnostic business logic
- Can be used by any interface (MCP, REST API, CLI, etc.)
- Fully testable independently
- No dependencies on interface layers
- Self-contained with input validation using Zod

**Interface Layers (`apps/`):**
- Thin wrappers around core modules
- MCP server: Exposes core modules via MCP protocol for AI agents
- Next.js app: Provides web UI for core modules
- Easy to add new interfaces (CLI, REST API, etc.)

**Testing Layer (`scripts/`):**
- Direct CLI access to core modules
- Fast iteration without running servers
- Isolated testing of individual modules
- CLI-friendly for CI/CD pipelines

## Complete Testing Workflow

**End-to-end testing example:**

```bash
# 1. Test ingestion
pnpm test:ingestion https://example.com "Example Website"
# Output: Website ID: abc123-def456-...

# 2. Test indexing (use website ID from step 1)
pnpm test:indexing abc123-def456-...

# 3. Test search (use domain from step 1)
pnpm test:search "What is this website about?" "example.com"
```

## MCP Tools (Interface Layer)

When using the MCP server interface, these tools are available:

- **`site_ingest`** - Ingest a new website (uses Ingestion Module)
- **`site_sync`** - Sync an existing website (uses Sync Module)
- **`site_ask`** - Ask questions about website content (uses Search Module)
- **`site_check_existing_content`** - Check if content already exists (uses Search Module)
- **`site_find_mentions`** - Find pages mentioning keywords (uses Search Module)
- **`site_reindex_url`** - Re-index a single URL (uses Individual URL Module)
- **`site_get_url_status`** - Get status of a specific URL (uses Individual URL Module)
- **`site_list`** - List all indexed websites

## License

MIT
