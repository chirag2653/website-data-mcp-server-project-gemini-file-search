# Ingestion Service: Ready for Indexing Status

## ✅ Updates Made

### 1. Ingestion Service (`src/services/ingestion.ts`)
- **Updated**: Comment clarifies that `status='processing'` means "READY FOR INDEXING"
- **When**: After scraping completes and markdown is stored
- **Purpose**: Makes it clear that ingestion marks pages as ready for the indexing service

```typescript
status: 'processing', // READY FOR INDEXING: Page scraped, markdown stored, ready for indexing service to pick up
```

### 2. Sync Service (`src/services/sync.ts`)
- **Updated**: Same clarification for sync operations
- **When**: After sync scraping completes
- **Purpose**: Consistent behavior with ingestion

```typescript
status: 'processing', // READY FOR INDEXING: Page scraped, markdown stored, ready for indexing service to pick up
```

### 3. Indexing Service Query (`src/clients/supabase.ts`)
- **Updated**: Added comprehensive documentation to `getPagesReadyForIndexing()`
- **Clarifies**: What criteria pages must meet to be picked up
- **Purpose**: Makes it explicit what "ready for indexing" means

```typescript
/**
 * Get pages that are ready for indexing
 * 
 * Criteria:
 * - status = 'processing' (set by ingestion/sync after scraping - means "ready for indexing")
 * - markdown_content is not null (content has been scraped)
 * - gemini_file_id is null (not yet indexed in Gemini)
 * 
 * These are pages that have been scraped by ingestion/sync and are waiting to be indexed.
 */
```

### 4. Indexing Service (`src/services/indexing.ts`)
- **Updated**: Comment clarifies what pages it's picking up
- **Purpose**: Makes the connection between ingestion and indexing clear

```typescript
// Step 2: Get pages ready for indexing
// These are pages that ingestion/sync has scraped and marked as "ready for indexing"
// Criteria: status='processing' + markdown_content exists + no gemini_file_id yet
```

### 5. Lifecycle Service (`src/services/lifecycle.ts`)
- **Updated**: Comment for consistency
- **Purpose**: When reindexing, same clear status meaning

---

## Status Lifecycle

### Complete Flow

```
1. Discovery (Ingestion/Sync)
   → status = 'pending'
   
2. Scraping Complete (Ingestion/Sync)
   → status = 'processing' ✅ READY FOR INDEXING
   → markdown_content stored
   → gemini_file_id = null
   
3. Indexing Service Picks Up
   → Finds pages with status='processing' + markdown_content + no gemini_file_id
   → Uploads to Gemini
   
4. Indexing Complete
   → If Gemini document is ACTIVE: status = 'active' ✅
   → If Gemini document is PENDING/FAILED: status = 'processing' (retry next run)
```

---

## Status Values

| Status | Meaning | Set By | Next Step |
|--------|---------|--------|-----------|
| `'pending'` | Page discovered, not scraped | Ingestion/Sync | Scrape |
| `'processing'` | **READY FOR INDEXING** - Scraped, markdown stored | Ingestion/Sync | Index |
| `'processing'` | Indexing in progress (Gemini PENDING) | Indexing | Retry next run |
| `'active'` | Fully indexed and ready | Indexing | ✅ Complete |
| `'deleted'` | Page deleted from website | Sync | N/A |
| `'redirect'` | Page is a redirect | Scrape | N/A |
| `'error'` | Error occurred | Any | Retry/Manual fix |

---

## Key Points

### ✅ No Database Migration Needed
- We're using the existing `'processing'` status
- Just clarifying its meaning through comments
- No enum changes required

### ✅ Clear Semantics
- **After Ingestion/Sync**: `status='processing'` = "ready for indexing"
- **During Indexing**: `status='processing'` = "being processed in Gemini"
- **After Indexing**: `status='active'` = "fully indexed and ready"

### ✅ Indexing Service Query
The indexing service picks up pages that are:
1. `status = 'processing'` (marked as ready by ingestion/sync)
2. `markdown_content IS NOT NULL` (content has been scraped)
3. `gemini_file_id IS NULL` (not yet indexed)

---

## Summary

✅ **Ingestion Service**: Now clearly marks pages as "ready for indexing"  
✅ **Indexing Service**: Picks up pages marked as "ready for indexing"  
✅ **Comments**: All services have clear documentation about status meanings  
✅ **No Migration**: Using existing `'processing'` status, just clarifying semantics

The system now has clear, documented flow from ingestion → indexing! 🎉

