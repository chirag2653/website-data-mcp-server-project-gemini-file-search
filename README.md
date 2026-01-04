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

**Workflow**: Takes a seed URL and optional display name. Validates input using Zod, normalizes and extracts base domain (handles www vs non-www), checks if website already exists (by base domain), handles stuck ingestion jobs with recovery logic, creates Gemini File Search store if new website, creates website record in Supabase, discovers all URLs via FireCrawl's `/map` endpoint, filters URLs to match base domain, batch scrapes all pages using FireCrawl's batch API with progress tracking, validates and stores only complete scrapes (non-empty markdown) in Supabase with status `ready_for_indexing`, discards incomplete scrapes (missing markdown, empty content) to ensure data quality, and creates process job for tracking. Does NOT automatically trigger indexing—pages are stored ready for indexing to be triggered separately.

**Input**: `seedUrl` (string), `displayName` (optional string)

**Processing**: Input validation → Domain normalization → Website existence check → Gemini store creation → FireCrawl URL discovery → Batch scraping → Content validation → Database storage

**Output**: Returns `IngestionResult` with website ID, domain, Gemini store ID, pages discovered count, pages scraped count, ingestion job ID, and any errors encountered.

**Test Script**: `scripts/test-ingestion.ts` - See "Test Ingestion Module" section below.

### 2. Indexing Module (`packages/core/src/services/indexing.ts`)

**Purpose**: Uploads stored markdown content to Gemini File Search for semantic search. Separated from ingestion to allow retries without re-scraping. Handles three types of operations: new page indexing, re-indexing changed pages, and deletion of missing pages.

**Workflow**: Takes a website ID and optional job metadata. Processes pages in three categories:
- **New pages** (`ready_for_indexing`): Uploads markdown to Gemini File Search, verifies document state (ACTIVE/PROCESSING/FAILED), and updates status to `active` when document is fully processed
- **Updated pages** (`ready_for_re_indexing`): Deletes old Gemini document first, then uploads new content, verifies state, and updates to `active`
- **Deletion pages** (`ready_for_deletion`): Deletes document from Gemini and marks page as `deleted` in database

Processes pages in batches of 5 (parallel uploads) with incremental database updates after each batch. Limits to 200 pages per run for memory management. Verifies document state from Gemini API (ACTIVE = ready, PENDING = processing, FAILED = retry) and only marks as `active` when document is fully processed. Handles rate limiting with automatic retries.

**Input**: `websiteId` (string), `options` (optional: `ingestionJobId`, `syncJobId`, `autoCreateStore`)

**Processing**: Database query → Gemini store verification → Batch upload (5 parallel) → Document state verification → Incremental status updates

**Output**: Returns `IndexingResult` with indexing job ID, website ID, pages indexed count (only ACTIVE documents), and any errors encountered.

**Test Script**: `scripts/test-indexing.ts` - See "Test Indexing Module" section below.

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

**Test Script**: `scripts/test-sync.ts` - See "Test Sync Module" section below.

### 4. Search Module (`packages/core/src/services/search.ts`)

**Purpose**: Semantic search queries using Gemini File Search. Ask questions, check for existing content, and find keyword mentions across indexed websites.

**Workflow**: Takes a question and website URL/domain. Validates input using Zod (question max 5000 chars, URL must be valid), normalizes domain to base domain (handles www vs non-www, extracts domain from URLs), looks up website by base domain (same logic as ingestion), verifies website exists and has Gemini File Search store, executes semantic query using Gemini File Search API, generates grounded answers with source citations, cleans and formats answer text, and returns formatted results with answer text and source URLs with titles and snippets.

**Input**: `question` (string, max 5000 chars), `websiteUrl` (string - can be full URL, domain, or domain with path)

**Processing**: Input validation → Domain normalization → Website lookup → Gemini File Search query → Answer generation → Result formatting

**Output**: Returns `SearchResult` with answer text (cleaned), source citations (URLs, titles, snippets), website ID, and metadata.

**Test Script**: `scripts/test-search.ts` - See "Test Search Module" section below.

### 5. Individual URL Module (`packages/core/src/services/individual-url.ts`)

**Purpose**: Single URL indexing for existing websites. Handles indexing individual URLs by automatically finding the website by domain—similar to Google Search Console's "Request Indexing" feature. Just provide a URL and it handles the rest.

**Workflow**: Takes just a URL (no website ID needed). Automatically extracts the base domain from the URL, normalizes domain (handles www vs non-www), finds the website by base domain, validates the website exists and has pages, validates URL domain matches website domain, checks if the URL already exists:
- If already `active`: Returns early with success message
- If `ready_for_indexing`: Triggers indexing and checks status
- Otherwise: Re-scrapes the URL

For new URLs: Creates process job for tracking, scrapes URL using `batchScrapeAndProcess` (same as ingestion/sync for consistency), stores the page in database with status `ready_for_indexing`, automatically triggers indexing service, and checks final status after indexing completes. Also provides status checking (`getUrlStatus`) and reindexing (`reindexUrl`) functions.

**Input**: `url` (string) - Just the URL, no website ID needed

**Processing**: Domain extraction → Website lookup → Validation → Status check → Batch scraping (if needed) → Database storage → Indexing trigger → Status verification

**Output**: Returns `IndividualUrlResult` with success status, website ID (auto-discovered), URL, current status (`active`, `processing`, or `error`), helpful error messages, suggestions (e.g., to run ingestion if website doesn't exist), and optional `canAutoIngest` flag.

**Key Features**:
- **Automatic website discovery**: No need to know the website ID—just provide a URL
- **Smart validation**: Checks if URL already exists and returns early if already active
- **Consistent scraping**: Uses same `batchScrapeAndProcess` function as ingestion/sync
- **Auto-indexing**: Automatically triggers indexing service after scraping
- **Helpful UX**: Provides clear error messages and suggestions if website doesn't exist
- **Status checking**: `getUrlStatus()` function to check current status of any URL
- **Reindexing**: `reindexUrl()` function to force re-scrape and re-index an existing URL

**Test Script**: `scripts/test-individual-url.ts` - See "Test Individual URL Module" section below.

### 6. Cleanup Module (`packages/core/src/services/cleanup.ts`)

**Purpose**: Utility module for cleaning up Gemini File Search stores and documents. Useful for testing, resetting, or removing old data.

**Workflow**: Takes cleanup options (delete stores flag, store filter pattern). Lists all Gemini File Search stores (optionally filtered by pattern), deletes all documents from each store (handles pagination for large stores), optionally deletes the stores themselves, handles rate limiting and retries with exponential backoff, and provides detailed cleanup reports with per-store statistics.

**Input**: `options` (object: `deleteStores` boolean, `storeFilter` optional string pattern)

**Processing**: Store enumeration → Document deletion (with pagination) → Optional store deletion → Error handling with retries

**Output**: Returns `CleanupResult` with stores processed count, stores deleted count, documents deleted count, per-store details, and any errors encountered.

**Note**: This module does not have a dedicated test script, but can be tested via the cleanup commands in package.json (`pnpm cleanup` and `pnpm cleanup:docs`).

## Testing Core Modules

Each core module has a dedicated test script in the `scripts/` directory. These CLI tools allow you to test modules directly without running the MCP server or web application, making development and debugging faster and easier.

### Test Ingestion Module

**Script**: `scripts/test-ingestion.ts`

**Command**: `pnpm test:ingestion <url> [displayName]`

**Example**:
```bash
pnpm test:ingestion https://www.peersignal.org/ "PeerSignal"
```

**What it does**: 
- Validates the input URL and optional display name
- Calls the ingestion module to create a Gemini File Search store
- Discovers all URLs via FireCrawl `/map` endpoint
- Batch scrapes all pages using FireCrawl batch API
- Stores only complete scrapes (non-empty markdown) in database with status `ready_for_indexing`
- Discards incomplete scrapes (ensures data quality)
- Outputs the website ID, domain, Gemini store ID, pages discovered count, pages scraped count, ingestion job ID, and any errors

**Output**: Website ID (for use in subsequent indexing), domain, Gemini Store ID, pages discovered, pages scraped, ingestion job ID, and error list.

### Test Indexing Module

**Script**: `scripts/test-indexing.ts`

**Command**: `pnpm test:indexing <websiteId>`

**Example**:
```bash
pnpm test:indexing a0001d33-25ee-41b5-b79a-0dbac05296fb
```

**Prerequisites**: Website must exist in database and have pages with status `ready_for_indexing`, `ready_for_re_indexing`, or `ready_for_deletion` with `markdown_content`.

**What it does**: 
- Verifies the website exists in the database
- Checks for pages ready for processing (new, re-index, deletion)
- Shows page status breakdown
- Calls the indexing module to:
  - Upload new pages to Gemini File Search
  - Re-index changed pages (deletes old document first)
  - Delete missing pages from Gemini
- Verifies document state from Gemini API (ACTIVE/PROCESSING/FAILED)
- Updates page status to `active` only when document is fully processed
- Outputs the indexing job ID, pages indexed count (only ACTIVE documents), and any errors

**Output**: Indexing job ID, website ID, pages indexed count (only fully processed ACTIVE documents), and error list.

### Test Sync Module

**Script**: `scripts/test-sync.ts`

**Command**: `pnpm test:sync <websiteId>`

**Example**:
```bash
pnpm test:sync 4aaa8a34-4198-463c-9b88-c44985660dd6
```

**Prerequisites**: Website must exist in database and have been ingested (must have at least one page and a Gemini store).

**What it does**: 
- Verifies website exists and has prerequisites
- Checks existing pages and their statuses
- Runs sync service which:
  - Retries incomplete pages from previous syncs (self-healing)
  - Discovers current URLs via FireCrawl `/map`
  - Categorizes URLs (new, existing, missing)
  - Batch scrapes new URLs
  - Checks existing URLs for content changes (similarity-based)
  - Increments missing_count for missing URLs
  - Marks URLs for deletion if missing_count >= threshold
  - Triggers indexing pipeline automatically
- Displays comprehensive results including rich metadata statistics:
  - URL categorization (new, existing, missing counts)
  - Content changes (unchanged, changed, empty content counts)
  - Similarity statistics (average, min, max, threshold)
  - Error tracking (HTTP 404, 410 counts)
  - Missing count statistics (average, maximum, threshold)
  - Status changes (ready_for_indexing, ready_for_re_indexing, ready_for_deletion)

**Output**: Sync job ID, URLs discovered, URLs updated, URLs deleted, URLs errored, detailed statistics (categorization, content changes, similarity, errors, missing count, status changes), and error list.

### Test Search Module

**Script**: `scripts/test-search.ts`

**Command**: `pnpm test:search <question> <websiteDomain>`

**Example**:
```bash
pnpm test:search "What is PeerSignal about?" "peersignal.org"
```

**Prerequisites**: Website must exist in database and have indexed pages with status `active` (run ingestion and indexing first).

**What it does**: 
- Validates the question (max 5000 chars) and website URL/domain input using Zod
- Normalizes domain to base domain (handles www vs non-www)
- Looks up website by base domain
- Verifies website has Gemini File Search store
- Calls the search module to execute a semantic query using Gemini File Search
- Formats and displays the cleaned answer with source citations
- Outputs the answer text, source URLs, titles, snippets, and website ID

**Output**: Answer text (cleaned), source citations (URLs, titles, snippets), website ID, and metadata.

### Test Individual URL Module

**Script**: `scripts/test-individual-url.ts`

**Command**: `pnpm test:individual-url <url>`

**Example**:
```bash
pnpm test:individual-url https://example.com/new-page
```

**Prerequisites**: Website must exist in database and have at least one page (must have been ingested first).

**What it does**: 
- Automatically extracts base domain from URL
- Finds the website by base domain (no website ID needed)
- Validates the website exists and has pages
- Validates URL domain matches website domain
- Checks if URL already exists:
  - If already `active`: Returns early with success message
  - If `ready_for_indexing`: Triggers indexing and checks status
  - Otherwise: Re-scrapes the URL
- For new URLs: Creates process job, scrapes URL using batch scraping (same as ingestion/sync), marks page as `ready_for_indexing`, triggers indexing service automatically, checks final status after indexing
- Displays detailed results including page title, status, content hash, Gemini file ID, and helpful messages or suggestions

**Output**: Success status, website ID (auto-discovered), URL, current status (`active`, `processing`, or `error`), page details (title, status, content hash, Gemini file ID), helpful messages, and suggestions (e.g., to run ingestion if website doesn't exist).

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
│   ├── test-individual-url.ts   # Test individual URL module
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

# 5. Test individual URL indexing (just provide a URL)
pnpm test:individual-url https://example.com/new-page
```

## MCP Tools (Interface Layer)

When using the MCP server interface, these tools are available:

- **`site_ingest`** - Ingest a new website (uses Ingestion Module)
- **`site_sync`** - Sync an existing website (uses Sync Module)
- **`site_ask`** - Ask questions about website content (uses Search Module)
- **`site_check_existing_content`** - Check if content already exists (uses Search Module)
- **`site_find_mentions`** - Find pages mentioning keywords (uses Search Module)
- **`site_request_indexing`** - Request indexing for a single URL (uses Individual URL Module) - Just provide a URL, automatically finds website by domain
- **`site_reindex_url`** - Force re-scrape and re-index an existing URL (uses Individual URL Module)
- **`site_get_url_status`** - Get status of a specific URL (uses Individual URL Module)
- **`site_list`** - List all indexed websites

## License

MIT
