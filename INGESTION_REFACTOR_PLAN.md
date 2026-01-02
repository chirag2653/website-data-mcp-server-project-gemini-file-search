# Ingestion Refactor Plan

## Current Flow (Coupled)
1. Create Gemini store
2. Create website
3. Map → URLs
4. Scrape → Markdown
5. **Upload to Gemini** ← REMOVE THIS
6. Mark complete

## New Flow (Separated)

### Ingestion Phase
1. Create ingestion process_job
2. Create website (no Gemini store yet)
3. Map → URLs
4. Scrape → Markdown
5. **Store markdown in DB** (status: 'pending')
6. Track FireCrawl batch ID
7. Mark ingestion complete
8. Return ingestion job ID

### Indexing Phase (Separate)
1. Create indexing process_job
2. Create Gemini store (if needed)
3. Get pages with markdown
4. Upload to Gemini
5. Update pages with file IDs
6. Mark indexing complete

## Changes Needed

### Ingestion Service
- ✅ Remove Gemini store creation
- ✅ Remove Gemini uploads
- ✅ Create process_job (type: 'ingestion')
- ✅ Link website to ingestion job
- ✅ Link pages to ingestion job + batch ID
- ✅ Store markdown, set status to 'pending'
- ✅ Return ingestion job ID
- ✅ Optional: Auto-trigger indexing

### Return Type
```typescript
export interface IngestionResult {
  websiteId: string;
  domain: string;
  ingestionJobId: string;  // NEW
  pagesDiscovered: number;
  pagesScraped: number;    // NEW (pages with markdown stored)
  firecrawlBatchId: string; // NEW
  errors: SyncError[];
  // Remove: geminiStoreId, pagesIndexed
}
```

