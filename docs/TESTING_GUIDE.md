# Testing Guide

## Direct Testing of Core Services

You can test core business logic directly without going through Next.js or MCP server interfaces.

## Testing Indexing Service

### Prerequisites

1. **Website must exist** in your Supabase database
2. **Pages must be ready for indexing**:
   - Status: `ready_for_indexing`
   - Has `markdown_content` (not null/empty)
   - No `gemini_file_id` (not already indexed)

### Method 1: Direct Script (Recommended)

```bash
# Test indexing for a specific website
pnpm test:indexing <websiteId>
```

**Example:**
```bash
pnpm test:indexing abc123-def456-ghi789
```

**What it does:**
- Verifies website exists
- Checks pages ready for indexing
- Runs indexing service directly
- Shows results and errors

**To find a website ID:**
```sql
-- Run in Supabase SQL editor
SELECT id, domain, display_name FROM websites;
```

### Method 2: Via Next.js UI

1. Start Next.js dev server: `pnpm web:dev`
2. Navigate to `http://localhost:3000`
3. Enter a URL to check if website exists
4. If website exists, you'll see an option to run indexing
5. Click "Run Indexing" button

### Method 3: Via MCP Server

If you have an MCP client connected:
- Use the `site_ingest` tool (triggers ingestion, which triggers indexing)
- Or use the indexing service programmatically via MCP

### Method 4: Programmatic (Node.js/TypeScript)

```typescript
import * as indexingService from '@website-data/core/services/indexing';

const result = await indexingService.indexWebsite('your-website-id', {
  autoCreateStore: true,
});

console.log('Pages indexed:', result.pagesIndexed);
console.log('Errors:', result.errors);
```

## Testing Ingestion Service

### Direct Script (To Be Created)

Similar to indexing, you can create a test script:

```bash
# Future: pnpm test:ingestion <url>
```

For now, use:
- **Next.js UI**: `pnpm web:dev` → Enter URL → Click "Run Ingestion"
- **MCP Server**: Use `site_ingest` tool

## Testing Search Service

```typescript
import * as searchService from '@website-data/core/services/search';

// Ask a question
const result = await searchService.askQuestion(
  'What is this website about?',
  'example.com'
);

console.log('Answer:', result.answer);
console.log('Sources:', result.sources);
```

## Architecture Summary

```
┌─────────────────────────────────────────┐
│         Core Services (Testable)        │
│  packages/core/src/services/            │
│  - ingestion.ts                         │
│  - indexing.ts  ← Test with script     │
│  - search.ts                            │
│  - sync.ts                              │
└─────────────────────────────────────────┘
           ▲              ▲
           │              │
    ┌──────┴──────┐  ┌────┴─────┐
    │  Next.js    │  │   MCP    │
    │  (UI)       │  │  Server  │
    └─────────────┘  └──────────┘
```

**Key Point:** Core services are framework-agnostic and can be tested directly!

