# Refactor Complete - Two-Phase Architecture Implementation

## ✅ All Changes Completed

### Architecture Summary

**Four Independent Services:**

1. **Ingestion Pipeline** (`src/services/ingestion.ts`)
   - Discovers URLs via FireCrawl `/map`
   - Batch scrapes with job ID tracking (`batchScrapeStart` + `batchScrapeWait`)
   - Writes only complete scrapes to DB (status='processing')
   - Discards incomplete/empty scrapes (never written)
   - Automatically triggers indexing pipeline when done
   - Registers new website with ID tracking

2. **Sync Pipeline** (`src/services/sync.ts`)
   - Only works for existing website ID
   - Discovers URLs via FireCrawl `/map`
   - Compares with existing pages
   - Batch scrapes new/changed URLs (with job ID tracking)
   - Writes only complete scrapes to DB (status='processing')
   - Discards incomplete/empty scrapes
   - Automatically triggers indexing pipeline when done

3. **Indexing Pipeline** (`src/services/indexing.ts`)
   - Independent pipeline (can be called separately)
   - Picks up pages with status='processing'
   - Filters by `website_id` (required)
   - Optional filter by `process_job_id` (ingestion or sync)
   - Uploads to Gemini → promotes to 'active'
   - Keeps 'processing' status on failure (can retry)

4. **Individual URL Indexing** (`src/services/individual-url.ts`) - **NEW**
   - Single URL indexing (similar to Google Search Console)
   - Uses direct scrape (`scrapeUrl`, not batch)
   - Only works if website exists (has pages from same domain)
   - Verifies URL is from same domain
   - Writes 'processing' status → triggers indexing pipeline

### Key Fixes Applied

#### Ingestion Service
- ✅ Fixed to use `batchScrapeStart` + `batchScrapeWait` (not `batchScrapeAndWait`)
- ✅ Tracks `firecrawl_batch_id` in process job
- ✅ Only writes complete scrapes (discards incomplete)
- ✅ Automatically triggers indexing

#### Sync Service
- ✅ Retry logic uses batch scrape (not individual `scrapeUrl`)
- ✅ New URLs use batch scrape with job ID tracking
- ✅ Existing URL checking uses `batchScrapeStart` + `batchScrapeWait`
- ✅ Changed pages write 'processing' (no Gemini upload)
- ✅ Tracks `firecrawl_batch_ids` array in process job
- ✅ Automatically triggers indexing

#### Indexing Service
- ✅ Uses `getPagesReadyForIndexing()` helper
- ✅ Filters by website_id and optional process_job_id
- ✅ Independent pipeline

#### Individual URL Service
- ✅ New service created
- ✅ Uses direct scrape (not batch)
- ✅ Validates website exists and has pages
- ✅ Validates domain match
- ✅ Writes 'processing' → triggers indexing

#### Lifecycle Service
- ✅ `addUrl()` updated to use new individual URL indexing service
- ✅ Marked as deprecated (for backward compatibility)

### Database Schema

**Status Lifecycle:**
- `pending` → `processing` → `active`
- Only `active` = fully complete (scrape + Gemini upload both succeeded)

**Process Job Tracking:**
- `process_jobs.firecrawl_batch_ids`: Array of batch IDs used
- `pages.created_by_ingestion_id`: Links page to ingestion job
- `pages.created_by_sync_id`: Links page to sync job
- `pages.last_updated_by_sync_id`: Links page to sync job that updated it
- `pages.firecrawl_batch_id`: Links page to FireCrawl batch

**Helper Function:**
- `getPagesReadyForIndexing()`: Gets pages with status='processing', has markdown, no gemini_file_id

### Files Modified

1. `src/services/ingestion.ts` - Fixed batch scrape, job ID tracking
2. `src/services/sync.ts` - Fixed all batch scrape usage, removed Gemini uploads
3. `src/services/indexing.ts` - Uses helper function
4. `src/services/individual-url.ts` - **NEW** service
5. `src/services/lifecycle.ts` - Updated `addUrl()` to use new service
6. `src/clients/supabase.ts` - Added `getPagesReadyForIndexing()` helper

### Architecture Compliance

✅ **Ingestion**: Uses batch scrape only, writes 'processing', triggers indexing
✅ **Sync**: Uses batch scrape only, writes 'processing', triggers indexing  
✅ **Indexing**: Independent pipeline, filters by website_id and process_job_id
✅ **Individual URL**: Uses direct scrape, validates website, writes 'processing'

### Testing Checklist

- [ ] Test ingestion: New website → batch scrape → indexing
- [ ] Test sync: Existing website → batch scrape → indexing
- [ ] Test indexing: Independent pipeline with filters
- [ ] Test individual URL: Single URL indexing with validation
- [ ] Verify incomplete scrapes are discarded (not written to DB)
- [ ] Verify only 'active' pages have gemini_file_id
- [ ] Verify process job tracking (batch IDs, lineage)

### Next Steps

1. Test the complete flow
2. Monitor process job statistics
3. Verify database state (no incomplete pages)
4. Check indexing pipeline picks up 'processing' pages correctly

