# Two-Phase Ingestion Design

## Problem

Current ingestion couples scraping and Gemini indexing, which causes:
- If Gemini upload fails, we lose the scraped markdown (waste FireCrawl credits)
- Can't retry indexing without re-scraping
- Heavy operations are coupled together

## Solution: Separate Ingestion and Indexing

### Phase 1: Ingestion (Heavy Job)
**Purpose**: Discover and scrape all content, store markdown in database

**Steps**:
1. Map website → get all URLs
2. Batch scrape all URLs → get markdown
3. Store markdown + metadata in database
4. Mark ingestion as "complete"

**Completion Criteria**: All markdown stored in database (status: 'pending' or 'processing')

**No Gemini operations** during ingestion phase.

### Phase 2: Indexing (Separate Process)
**Purpose**: Upload stored markdown to Gemini File Search

**Steps**:
1. Create Gemini File Search store (if not exists)
2. Get all pages with stored markdown
3. Upload each page to Gemini
4. Update pages with Gemini file IDs
5. Mark indexing as "complete"

**Completion Criteria**: All pages uploaded to Gemini (status: 'active')

**Can be retried independently** without re-scraping.

## Process Flow

```
┌─────────────────────────────────────┐
│  Ingestion Process (process_type:  │
│  'ingestion')                        │
├─────────────────────────────────────┤
│  1. Map website → URLs              │
│  2. Batch scrape → Markdown         │
│  3. Store markdown in DB            │
│  4. Mark ingestion = 'completed'    │
└─────────────────────────────────────┘
              │
              ▼
    [Markdown stored in DB]
    [Pages status: 'pending']
              │
              ▼
┌─────────────────────────────────────┐
│  Indexing Process (process_type:    │
│  'indexing')                        │
├─────────────────────────────────────┤
│  1. Create Gemini store             │
│  2. Get pages with markdown         │
│  3. Upload to Gemini                │
│  4. Update pages with file IDs      │
│  5. Mark indexing = 'completed'     │
└─────────────────────────────────────┘
              │
              ▼
    [Pages status: 'active']
    [Gemini file IDs stored]
```

## Database Schema Updates

### Process Type Enum
```sql
CREATE TYPE process_type AS ENUM (
  'ingestion',      -- Scraping phase
  'indexing',       -- Gemini upload phase
  'sync',           -- Incremental sync
  'manual_reindex'  -- Manual re-index
);
```

### Process Jobs
- `ingestion` job: Tracks scraping phase
- `indexing` job: Tracks Gemini upload phase
- Both linked to same website

### Pages Status Flow
```
pending → (ingestion stores markdown) → processing → (indexing uploads) → active
```

## API Design

### Ingestion Function
```typescript
export async function ingestWebsite(
  seedUrl: string,
  displayName?: string
): Promise<IngestionResult> {
  // 1. Create ingestion process_job
  // 2. Map website
  // 3. Scrape all URLs
  // 4. Store markdown in DB
  // 5. Mark ingestion complete
  // 6. Return ingestion ID (for triggering indexing)
  
  return {
    websiteId: string,
    ingestionJobId: string,  // NEW: Return ingestion job ID
    pagesDiscovered: number,
    pagesScraped: number,    // NEW: Pages with markdown stored
    errors: SyncError[]
  };
}
```

### Indexing Function (NEW)
```typescript
export async function indexWebsite(
  websiteId: string,
  ingestionJobId?: string  // Optional: link to ingestion job
): Promise<IndexingResult> {
  // 1. Create indexing process_job
  // 2. Create/get Gemini store
  // 3. Get all pages with markdown (status: 'pending' or 'processing')
  // 4. Upload each to Gemini
  // 5. Update pages with Gemini file IDs
  // 6. Mark indexing complete
  
  return {
    indexingJobId: string,
    pagesIndexed: number,
    errors: SyncError[]
  };
}
```

## Benefits

1. **Resilience**: If indexing fails, markdown is still stored
2. **Retry**: Can retry indexing without re-scraping
3. **Separation**: Clear separation of concerns
4. **Efficiency**: Don't waste FireCrawl credits on retries
5. **Flexibility**: Can trigger indexing separately or automatically

## Implementation Plan

1. ✅ Update process_type enum to include 'indexing'
2. ✅ Create indexing service
3. ⏳ Modify ingestion to stop after storing markdown
4. ⏳ Add auto-trigger option (ingestion → indexing)
5. ⏳ Update tools to expose indexing separately

