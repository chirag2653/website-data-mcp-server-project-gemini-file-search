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

**Purpose**: Incremental updates and refresh of website content. Discovers new pages, detects changed content using similarity-based comparison, and safely handles deletions using a threshold-based approach to prevent false deletions from temporary issues.

#### Overview

The sync module performs incremental updates to keep website content fresh. It runs after initial ingestion and compares the current state of a website (via FireCrawl's `/map` endpoint) with what's stored in the database to identify:
- **New URLs**: Pages that exist on the website but not in the database
- **Existing URLs**: Pages that exist in both (checked for content changes)
- **Missing URLs**: Pages that exist in the database but not found in the current website map

#### How It Works

**Step 0: Self-Healing (Retry Logic)**
- Checks for pages with status `pending`, `processing`, or `error` from previous syncs
- Pages with markdown content are set to `ready_for_indexing` or `ready_for_re_indexing` (based on whether they have a `gemini_file_id`)
- Pages without markdown are re-scraped using FireCrawl batch API

**Step 1: URL Discovery**
- Re-runs FireCrawl `/map` endpoint to get current URLs from the website
- Filters URLs to match the website's exact domain
- Normalizes URLs (removes trailing slashes, normalizes protocols)

**Step 2: URL Categorization**
- Compares current URLs with database records to create three categories:
  - **New URLs**: In FireCrawl map but not in database → Need to be scraped and indexed
  - **Existing URLs**: In both map and database → Need to be checked for content changes
  - **Missing URLs**: In database but not in map → Missing count incremented

**Step 3: Handle New URLs**
- Uses shared `batchScrapeAndProcess` function (same logic as ingestion)
- Batch scrapes all new URLs using FireCrawl batch API
- Validates scraped content (must have non-empty markdown)
- Stores pages in database with status `ready_for_indexing`
- Automatically triggers indexing pipeline (async)

**Step 4: Handle Existing URLs (Content Change Detection)**
- Batch scrapes existing URLs to get current content
- For each existing page:
  - **404/410 Errors**: Increments `missing_count` (treats as missing, not deleted)
  - **Empty Content**: Resets `missing_count` to 0, updates `last_seen` timestamp
  - **Content Comparison**: Uses similarity-based detection (not just hash comparison)
    - Compares new markdown with existing markdown using Sørensen–Dice coefficient
    - Default similarity threshold: 95% (configurable via `SIMILARITY_THRESHOLD`)
    - **Unchanged** (similarity ≥ threshold):
      - Updates `content_hash`, `last_scraped`, `last_seen` timestamps
      - Resets `missing_count` to 0
      - Keeps existing `gemini_file_id` (no re-indexing needed)
    - **Changed** (similarity < threshold):
      - Sets status to `ready_for_re_indexing`
      - Updates `markdown_content`, `content_hash`, and metadata
      - Clears `gemini_file_id` (indexing service will delete old document and upload new one)
      - Resets `missing_count` to 0

**Step 5: Handle Missing URLs**
- URLs found in database but not in FireCrawl map
- Increments `missing_count` for each missing URL
- Does NOT delete immediately (prevents false deletions from temporary issues)

**Step 6: Handle Deletions (Threshold-Based)**
- Only marks URLs for deletion if `missing_count >= threshold` (default: 3)
- This means a URL must be missing for 3 consecutive syncs before deletion
- Sets status to `ready_for_deletion` (indexing service handles actual Gemini deletion)
- Prevents false deletions from:
  - Temporary network issues
  - Site maintenance
  - FireCrawl API issues
  - Temporary redirects

**Step 7: Rich Metadata Tracking**
- Stores comprehensive statistics in process job metadata:
  - **Categorization**: New, existing, missing URL counts
  - **Content Changes**: Unchanged, changed, empty content counts
  - **Similarity Statistics**: Average, min, max similarity percentages, pages compared
  - **Error Tracking**: HTTP 404, 410 counts, total errors
  - **Missing Count Statistics**: Average, maximum missing_count, deletion threshold
  - **Status Changes**: Pages set to `ready_for_indexing`, `ready_for_re_indexing`, `ready_for_deletion`

**Step 8: Auto-Trigger Indexing**
- Automatically triggers indexing pipeline (async, fire-and-forget)
- Indexing service picks up pages with:
  - `ready_for_indexing` (new pages)
  - `ready_for_re_indexing` (changed pages - deletes old Gemini document first)
  - `ready_for_deletion` (missing pages - deletes from Gemini)

#### Key Features

1. **Similarity-Based Change Detection**: Uses string similarity (Sørensen–Dice) instead of exact hash matching to avoid false positives from minor changes (e.g., one character difference)

2. **Threshold-Based Deletion**: Requires multiple consecutive misses before deletion to prevent false deletions from temporary issues

3. **Self-Healing**: Automatically retries failed/incomplete pages from previous syncs

4. **Rich Metadata**: Tracks comprehensive statistics for monitoring and analytics

5. **Centralized Gemini Operations**: All Gemini deletions happen in indexing service, not sync service

#### Configuration

Environment variables:
- `SIMILARITY_THRESHOLD` (default: `0.95`): Content similarity threshold (0-1). Pages with similarity ≥ threshold are considered unchanged.
- `DELETION_THRESHOLD` (default: `3`): Number of consecutive syncs a URL must be missing before deletion.

#### Input

- `websiteId` (string): UUID of the website to sync

**Prerequisites**:
- Website must exist in database
- Website must have at least one page (must have been ingested first)
- Website must have a Gemini store ID (created during ingestion)

#### Output

Returns `SyncResult` with:
- `syncLogId`: Process job ID for tracking
- `urlsDiscovered`: Number of new URLs found
- `urlsUpdated`: Number of pages updated (new + changed)
- `urlsDeleted`: Number of pages marked for deletion
- `urlsErrored`: Number of errors encountered
- `errors`: Array of error details

**Process Job Metadata** includes rich statistics (see Step 7 above).

#### Status Flow

```
New URL → ready_for_indexing → (indexing) → active
Existing URL (unchanged) → (no status change, keep active)
Existing URL (changed) → ready_for_re_indexing → (indexing) → active
Missing URL → missing_count++ → (if >= threshold) → ready_for_deletion → (indexing) → deleted
```

#### Testing

**Command**: `pnpm test:sync <websiteId>`

**Example**:
```bash
pnpm test:sync 4aaa8a34-4198-463c-9b88-c44985660dd6
```

**What it does**: Verifies website exists, checks existing pages, runs sync service, displays results including rich metadata statistics, and shows what happened (new URLs, changed pages, missing URLs, deletions).

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

### Test Sync Module

**Command**: `pnpm test:sync <websiteId>`

**Example**:
```bash
pnpm test:sync 4aaa8a34-4198-463c-9b88-c44985660dd6
```

**Prerequisites**: Website must exist in database and have been ingested (must have at least one page and a Gemini store).

**What it does**: Verifies website exists and has prerequisites, checks existing pages and their statuses, runs sync service to discover new URLs, detect content changes, and handle missing URLs, displays comprehensive results including rich metadata statistics (URL categorization, content changes, similarity statistics, error tracking, missing count statistics, status changes), and shows what happened (new URLs discovered, pages updated, pages deleted).

**Output**: Sync job ID, URLs discovered, URLs updated, URLs deleted, URLs errored, detailed statistics (categorization, content changes, similarity, errors, missing count, status changes), and error list.

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
│   ├── test-sync.ts             # Test sync module
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

# 3. Test sync (use website ID from step 1, after some time has passed)
pnpm test:sync abc123-def456-...

# 4. Test search (use domain from step 1)
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
