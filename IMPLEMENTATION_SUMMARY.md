# Implementation Summary: Two-Phase Ingestion Architecture

## ✅ Completed Implementation

### Architecture Overview

**Three Independent Pipelines:**
1. **Ingestion Pipeline**: Discover → Scrape → Write 'processing' → Trigger Indexing
2. **Sync Pipeline**: Discover → Scrape → Write 'processing' → Trigger Indexing
3. **Indexing Pipeline**: Independent, picks up 'processing' pages → Upload to Gemini → Set 'active'

### Key Changes

#### 1. Ingestion Service (`src/services/ingestion.ts`)
- ✅ Removed Gemini upload from ingestion
- ✅ Only writes complete scrapes to DB (status='processing')
- ✅ Discards incomplete/empty scrapes (never written to DB)
- ✅ Uses batch scrape with job ID polling
- ✅ Tracks `firecrawl_batch_id` in process job
- ✅ Automatically triggers indexing pipeline when done

**Flow:**
```
Map → Batch Scrape (job ID) → Filter Complete → Write 'processing' → Trigger Indexing
```

#### 2. Sync Service (`src/services/sync.ts`)
- ✅ Removed Gemini upload from sync
- ✅ Only writes complete scrapes to DB (status='processing')
- ✅ Discards incomplete/empty scrapes
- ✅ Uses batch scrape with job ID polling
- ✅ Tracks `firecrawl_batch_ids` array in process job
- ✅ Automatically triggers indexing pipeline when done

**Flow:**
```
Map → Compare → Batch Scrape New/Changed → Filter Complete → Write 'processing' → Trigger Indexing
```

#### 3. Indexing Service (`src/services/indexing.ts`)
- ✅ Independent pipeline (can be called separately)
- ✅ Uses `getPagesReadyForIndexing()` helper
- ✅ Filters by `website_id` (required)
- ✅ Optional filter by `process_job_id` (ingestion or sync)
- ✅ Uploads to Gemini → Promotes to 'active'
- ✅ Keeps 'processing' status on failure (can retry)

**Flow:**
```
Query 'processing' pages → Upload to Gemini → Set 'active'
```

#### 4. Supabase Client (`src/clients/supabase.ts`)
- ✅ Added `getPagesReadyForIndexing()` function
- ✅ Filters: status='processing', has markdown_content, no gemini_file_id
- ✅ Optional filtering by process job (created_by_ingestion_id, created_by_sync_id, last_updated_by_sync_id)

### Database Schema

**Status Lifecycle:**
- `pending` → `processing` → `active`
- Only `active` = fully complete (scrape + Gemini upload both succeeded)

**Process Job Tracking:**
- `process_jobs.firecrawl_batch_ids`: Array of batch IDs used
- `pages.created_by_ingestion_id`: Links page to ingestion job
- `pages.created_by_sync_id`: Links page to sync job
- `pages.firecrawl_batch_id`: Links page to FireCrawl batch

### Example Flow: 100 URLs Discovered

```
1. Ingestion:
   - Map discovers: 100 URLs
   - Batch scrape: 80 complete, 20 incomplete
   - Write to DB: 80 pages (status='processing')
   - Discard: 20 incomplete (never written)
   - Trigger: Indexing pipeline

2. Indexing:
   - Query: pages WHERE status='processing' AND website_id=...
   - Process: 80 pages
   - Upload to Gemini: 75 succeed, 5 fail
   - Result:
     - 75 pages → status='active' (fully complete)
     - 5 pages → status='processing' (can retry later)

3. Final State:
   - Database: 75 active, 5 processing
   - Process job: 100 discovered, 80 scraped, 75 indexed
```

### Benefits

1. **Clean Database**: Only complete scrapes written, incomplete discarded
2. **Crash-Safe**: Can resume from 'processing' status if interrupted
3. **No Re-Scraping**: Failed Gemini uploads can retry using stored markdown
4. **Clear Separation**: Ingestion/Sync (scrape) vs Indexing (upload) are distinct
5. **Flexible Filtering**: Indexing can filter by website_id and process_job_id
6. **Automatic Triggering**: Ingestion/Sync automatically trigger indexing when done

### Files Modified

- `src/services/ingestion.ts` - Refactored to scrape-only
- `src/services/sync.ts` - Refactored to scrape-only
- `src/services/indexing.ts` - Refactored to use helper function
- `src/clients/supabase.ts` - Added `getPagesReadyForIndexing()` helper

### Next Steps (Optional Enhancements)

1. Add status reset function before new processes
2. Add retry mechanism for failed indexing
3. Add monitoring/metrics for completion rates
4. Add manual indexing trigger endpoint

