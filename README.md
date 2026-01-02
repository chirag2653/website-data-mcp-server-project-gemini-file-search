# Website Data MCP Server

An MCP (Model Context Protocol) server that turns any website into a queryable knowledge base for AI agents using Gemini File Search.

## What It Does

1. **Ingests** a website via FireCrawl (discovers and scrapes all pages)
2. **Stores** page metadata and state in Supabase (system of record)
3. **Indexes** content in Gemini File Search (semantic RAG)
4. **Exposes** clean MCP tools for AI agents to query

**End Goal**: Turn any website into a queryable knowledge base using Gemini File Search.

## Features

- **Semantic Search**: Ask questions, get grounded answers with citations
- **Content Checking**: "Have we already written about X?"
- **Freshness Tracking**: Content hashes detect changes
- **Deletion Safety**: URLs must be missing 3 times before removal
- **Incremental Sync**: Only re-index changed content
- **Unit of Work Pattern**: Two-phase commit ensures data consistency
- **Self-Healing**: Automatic retry for failed/processing items
- **Credit Optimization**: Stores markdown to avoid re-scraping on retries

## Architecture

```
Website
  ↓
FireCrawl /map (Discover URLs)
  ↓
FireCrawl /batch-scrape (Get Markdown)
  ↓
Supabase (Store Metadata, Markdown, Hashes)
  ↓
Gemini File Search (Upload Documents)
  ↓
Query via Gemini generateContent + File Search Tool
  ↓
AI Agents / Claude / Internal Tools
```

## Setup

### Prerequisites

- Node.js 20+
- Supabase project (free tier works)
- Gemini API key with File Search access
- FireCrawl API key

### Installation

```bash
# Clone and install
cd website-data-mcp-server
npm install

# Copy environment template (if .env.example exists)
cp .env.example .env

# Edit .env with your credentials
```

### Environment Variables

Create a `.env` file in the project root:

```env
# Required
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=eyJ... (service role key)
GEMINI_API_KEY=AIza...
FIRECRAWL_API_KEY=fc-...

# Optional (with defaults)
GEMINI_MODEL=gemini-2.5-flash
LOG_LEVEL=info
SYNC_INTERVAL_HOURS=12
DELETION_THRESHOLD=3
```

**Note**: The `GEMINI_MODEL` must be one of the supported File Search models:
- `gemini-3-pro-preview`
- `gemini-3-flash-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash` (default)
- `gemini-2.5-flash-lite`

### Database Setup

The database schema is defined in `supabase/migrations/001_initial_schema.sql`. 

**If using Supabase:**
1. Open your Supabase project dashboard
2. Go to SQL Editor
3. Run the migration file contents

**If using Supabase MCP:**
The schema has already been applied to project `vuummomkxtoaxbwhvslv`.

### Build and Run

```bash
# Build
npm run build

# Run (production)
npm start

# Development mode (with watch)
npm run dev
```

## MCP Tools

### `site_ingest`

Ingest a new website starting from a seed URL. Automatically creates a Gemini File Search store, discovers all pages, scrapes content, and indexes everything.

```json
{
  "seedUrl": "https://example.com",
  "displayName": "Example Site"
}
```

**What it does:**
1. Creates Gemini File Search store
2. Creates website record in Supabase
3. Discovers all URLs via FireCrawl `/map`
4. Stores URLs in Supabase as `pending`
5. Batch scrapes all pages
6. Uploads each page to Gemini File Search
7. Updates Supabase with `active` status and content hashes

### `site_sync`

Perform incremental sync for a website. Discovers new pages, refreshes stale content, and handles deletions.

```json
{
  "websiteId": "uuid"
}
```

**What it does:**
1. Re-runs FireCrawl `/map` to get current URLs
2. Categorizes URLs: NEW, CHANGED, DELETED, UNCHANGED
3. Processes NEW: scrape + index
4. Processes CHANGED: re-scrape + update Gemini
5. Handles DELETED: increment `missing_count`, delete after threshold
6. Retries items with `processing` or `error` status

### `site_ask`

Ask a question and get a grounded answer from website content using Gemini File Search.

```json
{
  "question": "What products do we offer?",
  "websiteId": "optional-uuid"
}
```

**Returns:**
- Answer text (grounded in website content)
- Source citations (URLs and titles)

### `site_check_existing_content`

Check if the website already has content about a topic. Useful for marketing teams to avoid duplicate content.

```json
{
  "query": "marble temples",
  "websiteId": "optional-uuid"
}
```

### `site_find_mentions`

Find pages that mention specific keywords or products.

```json
{
  "keywords": ["marble", "temple"],
  "websiteId": "optional-uuid"
}
```

### `site_list`

List all indexed websites with their page counts and last sync times.

```json
{}
```

### `site_get_url_status`

Get indexing status of a specific URL.

```json
{
  "url": "https://example.com/page"
}
```

### `site_reindex_url`

Force re-scrape and re-index a specific URL. Use this to update content that has changed.

```json
{
  "url": "https://example.com/updated-page"
}
```

## How It Works

### Initial Ingestion

1. User provides a seed URL (e.g., homepage)
2. FireCrawl `/map` discovers all URLs on the site
3. URLs stored in Supabase with `pending` status
4. FireCrawl batch scrapes all pages (gets markdown)
5. For each page:
   - **Phase 1 (DB Draft)**: Save markdown + hash, set status = `processing`
   - **Phase 2 (Gemini)**: Upload document to Gemini File Search
   - **Phase 3 (DB Commit)**: Save Gemini file ID, set status = `active`
6. Supabase updated with content hashes and metadata

### Incremental Sync

1. Re-run FireCrawl `/map` to get current URLs
2. Compare with Supabase to categorize:
   - **NEW**: URL exists in crawl but not in DB → scrape + index
   - **CHANGED**: URL exists in both, but hash differs → re-scrape + update
   - **DELETED**: URL exists in DB but missing from crawl → increment `missing_count`
   - **UNCHANGED**: URL exists in both with same hash → skip
3. Process retry items (status = `processing` or `error`):
   - Use stored `markdown_content` if available (saves FireCrawl credits)
   - Otherwise re-scrape
   - Retry Gemini upload
4. Deletion logic:
   - URLs missing from map increment `missing_count`
   - Only deleted when `missing_count >= DELETION_THRESHOLD` (default: 3)
   - Prevents false deletions from temporary errors

### Semantic Search

1. Question passed to Gemini `generateContent` API
2. File Search tool automatically invoked by Gemini
3. Gemini retrieves relevant chunks from File Search store
4. Answer generated with grounding (citations)
5. Sources extracted from `groundingMetadata`
6. Returns answer + citations

**API Structure** (matches official docs):
```javascript
await genai.models.generateContent({
  model: "gemini-2.5-flash",
  contents: question,
  config: {
    tools: [
      {
        fileSearch: {
          fileSearchStoreNames: [storeName]
        }
      }
    ]
  }
});
```

## Implementation Details

### Unit of Work Pattern

Each URL is processed as an atomic unit to ensure data consistency:

1. **DB Draft Phase**: 
   - Save `markdown_content`, `content_hash`, `http_status_code`
   - Set `status = 'processing'`
   - Increment `firecrawl_scrape_count`
   - If script crashes here, we have the markdown stored for retry

2. **Gemini Operation Phase**:
   - Upload document to Gemini File Search (or delete old + upload new for CHANGED)
   - Wait for operation to complete

3. **DB Commit Phase**:
   - Save `gemini_file_id`, `gemini_file_name`, `gemini_document_state`
   - Set `status = 'active'`
   - Update `last_scraped`, reset `missing_count`, clear `error_message`

**Benefits:**
- Individual URL failures don't break entire sync
- Can retry failed items without re-scraping (uses stored markdown)
- Data consistency guaranteed

### Retry Logic (Self-Healing)

- Items with `status = 'processing'` or `status = 'error'` are automatically retried in next sync
- Uses stored `markdown_content` to avoid re-scraping (saves FireCrawl credits)
- Only re-scrapes if markdown is missing
- Tracks `firecrawl_scrape_count` to monitor API usage

### Deletion Logic (Robust)

- URLs missing from FireCrawl map increment `missing_count`
- Only deleted when `missing_count >= DELETION_THRESHOLD` (default: 3)
- Prevents false deletions from:
  - Temporary site downtime
  - Network errors
  - FireCrawl API issues
- `missing_count` resets to 0 if URL is found again

### Gemini API

- **Model**: `gemini-2.5-flash` (configurable, must be File Search supported model)
- **API Structure**: Matches official documentation exactly
- **No Assumptions**: Only uses documented features
- **Reference**: https://ai.google.dev/gemini-api/docs/file-search#javascript

## Database Schema

### Tables

**`websites`**
- Website records with Gemini store IDs
- Fields: `id`, `seed_url`, `domain`, `display_name`, `gemini_store_id`, `gemini_store_name`, `created_at`, `updated_at`

**`pages`**
- Page metadata, content hashes, Gemini file IDs, status
- Fields:
  - `id`, `website_id`, `url`, `path`, `title`
  - `status`: `pending` | `processing` | `active` | `deleted` | `redirect` | `error`
  - `content_hash`: SHA256 hash for change detection
  - `markdown_content`: Stored markdown (for retries without re-scraping)
  - `gemini_file_id`: Document ID in Gemini File Search
  - `gemini_file_name`: Display name in Gemini
  - `gemini_document_state`: Document state in Gemini
  - `gemini_document_size_bytes`: Size of document
  - `gemini_document_created_at`: When document was created
  - `missing_count`: Consecutive misses before deletion
  - `firecrawl_scrape_count`: Track scrape attempts
  - `http_status_code`: HTTP status from FireCrawl
  - `last_scraped`, `last_seen`: Timestamps
  - `error_message`: Error details if failed
  - `metadata`: JSONB for additional metadata (title, description, og_image, language)

**`sync_logs`**
- Sync execution history
- Fields: `id`, `website_id`, `sync_type`, `status`, `urls_discovered`, `urls_updated`, `urls_deleted`, `urls_errored`, `started_at`, `completed_at`, `error_message`

### Indexes

- `idx_pages_website_id` - Fast website page queries
- `idx_pages_url` - Fast URL lookups
- `idx_pages_status` - Fast status filtering
- `idx_pages_content_hash` - Fast change detection
- `idx_pages_missing_count` - Fast deletion queries
- `idx_pages_http_status` - Fast status code filtering
- `idx_pages_website_url` - Composite index for website + URL queries
- `idx_sync_logs_started_at` - Fast sync history queries
- `idx_websites_gemini_store` - Fast store lookups

## Claude Desktop Configuration

Add to your Claude Desktop config (`~/.claude.json` or settings):

```json
{
  "mcpServers": {
    "website-data": {
      "command": "node",
      "args": ["/path/to/website-data-mcp-server/dist/index.js"],
      "env": {
        "SUPABASE_URL": "...",
        "SUPABASE_SERVICE_KEY": "...",
        "GEMINI_API_KEY": "...",
        "FIRECRAWL_API_KEY": "..."
      }
    }
  }
}
```

## Project Structure

```
├── src/
│   ├── index.ts              # MCP server entry point
│   ├── config.ts             # Environment configuration
│   ├── clients/
│   │   ├── supabase.ts       # Supabase CRUD operations
│   │   ├── firecrawl.ts      # FireCrawl API client
│   │   └── gemini.ts         # Gemini File Search client
│   ├── services/
│   │   ├── ingestion.ts      # Initial website ingestion
│   │   ├── sync.ts           # Incremental sync
│   │   ├── search.ts         # Semantic search
│   │   └── lifecycle.ts      # URL management
│   ├── tools/
│   │   └── index.ts          # MCP tool definitions
│   ├── utils/
│   │   ├── hash.ts           # Content hashing
│   │   ├── url.ts            # URL utilities
│   │   └── logger.ts         # Logging
│   └── types/
│       └── index.ts          # TypeScript interfaces
├── supabase/
│   └── migrations/
│       └── 001_initial_schema.sql  # Database schema
├── .env                     # Environment variables (create this)
└── package.json
```

## API Reference

### FireCrawl Endpoints Used

- `POST /v2/map` - URL discovery
- `POST /v2/scrape` - Single page scraping
- `POST /v2/batch/scrape` - Batch scraping
- `GET /v2/batch/scrape/{id}` - Batch status

### Gemini File Search

- Creates persistent File Search stores
- Uploads documents with custom metadata (url, title, path)
- Queries using `generateContent` with File Search tool
- Returns grounded answers with citations
- Deletes documents when pages are removed

## Troubleshooting

### Missing API Keys
- **Error**: "Environment configuration errors"
- **Fix**: Check `.env` file has all required keys (SUPABASE_URL, SUPABASE_SERVICE_KEY, GEMINI_API_KEY, FIRECRAWL_API_KEY)

### Gemini API Error
- **Error**: "Failed to create File Search store"
- **Fix**: 
  - Verify `GEMINI_API_KEY` is valid
  - Check model name is supported for File Search
  - Ensure API key has File Search access

### FireCrawl API Error
- **Error**: "Failed to map website" or "Batch scrape failed"
- **Fix**: 
  - Verify `FIRECRAWL_API_KEY` is valid
  - Check FireCrawl account has credits
  - Verify website is accessible

### Supabase Connection Error
- **Error**: "Failed to create website" or database errors
- **Fix**: 
  - Verify `SUPABASE_URL` is correct
  - Check `SUPABASE_SERVICE_KEY` is the service role key (not anon key)
  - Ensure database schema is applied

### Build Errors
- **Error**: TypeScript compilation errors
- **Fix**: 
  - Run `npm install` to ensure dependencies are installed
  - Check Node.js version is 20+
  - Run `npm run build` to see specific errors

## Important Notes

- **Supabase Project**: If using existing project, verify schema matches `001_initial_schema.sql`
- **Gemini Model**: Must be a File Search supported model (see Environment Variables section)
- **File Search Pricing**: Free storage, pay only for embeddings at index time ($0.15 per 1M tokens)
- **Rate Limits**: FireCrawl has rate limits, batch scraping handles this automatically
- **Deletion Threshold**: Default is 3 consecutive misses before deletion (configurable via `DELETION_THRESHOLD`)

## Next Steps

1. **Test Ingestion**:
   - Provide a seed URL via `site_ingest` tool
   - Verify pages are indexed in Supabase and Gemini
   - Check sync logs for any errors

2. **Test Querying**:
   - Use `site_ask` with questions about the website
   - Verify answers are grounded in website content
   - Check citations are returned

3. **Test Sync**:
   - Make changes to website
   - Run `site_sync` for the website
   - Verify only changed pages are updated

4. **Schedule Syncs** (Future):
   - Add cron job or scheduled task
   - Run `site_sync` periodically (e.g., every 12 hours)

## License

MIT
