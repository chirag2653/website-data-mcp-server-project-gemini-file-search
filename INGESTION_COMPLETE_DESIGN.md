# Complete Ingestion Process Design - IMPLEMENTED

## ✅ Implementation Status

**All components have been implemented:**
- ✅ Ingestion service: Scrape only, write 'processing', trigger indexing
- ✅ Sync service: Scrape only, write 'processing', trigger indexing  
- ✅ Indexing service: Independent pipeline, filters by website_id and optional process_job_id
- ✅ Helper functions: `getPagesReadyForIndexing()` with filtering support

## Overview

This design implements a robust two-phase ingestion process that ensures **only fully completed URLs are written to the database**. The process separates discovery/scraping from indexing, with strict completion criteria.

## Core Principles

1. **Only Write Complete Scrapes**: Database rows are created after successful scrape (status='processing'), promoted to 'active' after Gemini upload
2. **No Hanging Statuses**: Reset incomplete/abruptly terminated URLs before starting new processes
3. **Two-Phase Architecture**: 
   - **Phase 1: Ingestion** - Discover URLs → Batch Scrape → Write to DB (status='processing')
   - **Phase 2: Indexing** - Upload to Gemini → Promote to status='active'
4. **Crash-Safe**: Process can resume from 'processing' status if interrupted
5. **Status Management**: Clear status lifecycle with automatic reset for incomplete processes

## Why Persistent (Not In-Memory)?

**Problem with In-Memory Approach:**
- Process runs 10+ minutes (batch scrape) + hours (Gemini uploads)
- If process crashes/interrupts, all progress lost
- Must restart from scratch (waste FireCrawl credits, time)

**Solution: Write After Scrape**
- After successful scrape: Write to DB with status='processing' + markdown_content
- After successful Gemini: Promote to status='active'
- If crash occurs: Resume from 'processing' pages (no re-scraping needed)
- Only 'active' = fully complete (scrape + Gemini both succeeded)

## Status Lifecycle

### Page Status States

```
pending → processing → active
   ↓           ↓
error ←────────┘
```

- **`pending`**: URL discovered but not yet scraped
- **`processing`**: Currently being scraped or uploaded to Gemini
- **`active`**: Fully processed (scraped + uploaded to Gemini)
- **`error`**: Failed at some stage (will be reset for retry)

### Status Reset Rules

Before starting any new ingestion/sync process:
1. Reset all `processing` statuses to `pending` (they were interrupted)
2. Reset `error` statuses older than X hours to `pending` (allow retry)
3. This ensures no URLs are left in hanging states

## Architecture (Revised: Persistent Approach)

**Why Not In-Memory?**
- Process can run for 10+ minutes (batch scrape) + hours (Gemini uploads)
- Risk of crashes/interruptions losing all progress
- Need ability to resume interrupted processes

**Solution: Write After Scrape, Promote After Gemini**

### Phase 1: Ingestion (Scraping)

**Goal**: Discover URLs, scrape content, **write to DB with status='processing'**

```
1. Map Website (FireCrawl /map)
   └─> Discover URLs (e.g., 100 URLs)
   
2. Start Batch Scrape Job
   └─> Get job_id from FireCrawl
   
3. Poll Batch Status
   └─> Wait for completion (long-running, up to 10 minutes)
   
4. Process Scrape Results
   └─> Filter complete results only
   └─> Validate: markdown exists, not empty, has metadata
   
5. **Write to Database** (status='processing')
   └─> Only URLs with complete scrape data
   └─> Store: url, markdown_content, content_hash, metadata
   └─> Status: 'processing' (not 'active' yet - Gemini pending)
   └─> Discard incomplete/empty results (don't write)
   
6. Update Process Job
   └─> Record: urls_discovered, urls_scraped, urls_written_to_db
   └─> Store firecrawl_batch_id
```

**Key Points**:
- URLs with **complete scrape data** are written to DB immediately
- Status is `'processing'` (not `'active'` - Gemini upload pending)
- Incomplete/empty scrapes are **discarded** (never written)
- If process crashes, we can resume from `'processing'` status

### Phase 2: Indexing (Gemini Upload)

**Goal**: Upload scraped content to Gemini, **promote to status='active'**

```
1. Get Pages with status='processing' (from Phase 1)
   └─> Only pages with markdown_content (scrape succeeded)
   
2. For Each Processing Page:
   a. Upload to Gemini File Search Store
      └─> Use stored markdown_content (no re-scraping needed)
      └─> Get gemini_file_id
   
   b. **ONLY IF UPLOAD SUCCEEDS**:
      └─> Update database: status='active'
      └─> Add: gemini_file_id, gemini_file_name
      └─> Clear error_message
   
   c. If Upload Fails:
      └─> Keep status='processing' (can retry later)
      └─> Set error_message
      └─> Log error in process_job.errors
      └─> Continue to next URL
   
3. Update Process Job
   └─> Record: urls_indexed (promoted to 'active')
   └─> Record: urls_errored (still 'processing' with errors)
```

**Key Points**:
- Only pages with status='active' are considered **fully complete**
- Pages with status='processing' have scrape data but Gemini upload pending/failed
- Can retry Gemini uploads without re-scraping (markdown already stored)
- If process crashes, resume from 'processing' status pages

## Database Schema Updates

### New Status Management Functions

```sql
-- Reset hanging statuses before starting new process
CREATE OR REPLACE FUNCTION reset_hanging_statuses(
  p_website_id UUID,
  p_reset_error_older_than_hours INTEGER DEFAULT 24
)
RETURNS INTEGER AS $$
DECLARE
  reset_count INTEGER;
BEGIN
  -- Reset processing statuses (interrupted)
  UPDATE pages
  SET status = 'pending',
      error_message = NULL,
      updated_at = NOW()
  WHERE website_id = p_website_id
    AND status = 'processing';
  
  GET DIAGNOSTICS reset_count = ROW_COUNT;
  
  -- Reset old error statuses (allow retry)
  UPDATE pages
  SET status = 'pending',
      error_message = NULL,
      updated_at = NOW()
  WHERE website_id = p_website_id
    AND status = 'error'
    AND updated_at < NOW() - (p_reset_error_older_than_hours || ' hours')::INTERVAL;
  
  GET DIAGNOSTICS reset_count = reset_count + ROW_COUNT;
  
  RETURN reset_count;
END;
$$ LANGUAGE plpgsql;
```

### Process Job Tracking

The `process_jobs` table already exists and tracks:
- `urls_discovered`: Total URLs found via map
- `urls_updated`: Successfully written to database (scrape + Gemini)
- `urls_errored`: Failed at any stage
- `firecrawl_batch_ids`: Array of batch job IDs used

## Implementation Flow

### Complete Ingestion Function

```typescript
async function ingestWebsite(seedUrl: string, displayName?: string) {
  // 1. Setup
  const website = await createWebsite(seedUrl, displayName);
  const geminiStore = await createGeminiStore(website);
  
  // 2. Reset any hanging statuses
  await resetHangingStatuses(website.id);
  
  // 3. Create ingestion process job
  const ingestionJob = await createProcessJob({
    website_id: website.id,
    process_type: 'ingestion',
    status: 'running'
  });
  
  try {
    // PHASE 1: INGESTION (Scraping)
    const ingestionResult = await runIngestionPhase(
      website,
      ingestionJob,
      seedUrl
    );
    
    // PHASE 2: INDEXING (Gemini Upload)
    const indexingResult = await runIndexingPhase(
      website,
      ingestionJob
    );
    
    // Update final statistics
    await updateProcessJob(ingestionJob.id, {
      status: 'completed',
      urls_discovered: ingestionResult.urlsDiscovered,
      urls_updated: indexingResult.pagesIndexed, // Only fully complete ('active')
      urls_errored: indexingResult.errors.length, // Still 'processing' with errors
      completed_at: new Date().toISOString()
    });
    
    return {
      websiteId: website.id,
      pagesDiscovered: ingestionResult.urlsDiscovered,
      pagesScraped: ingestionResult.urlsWrittenToDb, // Written to DB (status='processing')
      pagesIndexed: indexingResult.pagesIndexed, // Fully complete (status='active')
      errors: indexingResult.errors
    };
    
  } catch (error) {
    await updateProcessJob(ingestionJob.id, {
      status: 'failed',
      completed_at: new Date().toISOString()
    });
    throw error;
  }
}
```

### Phase 1: Ingestion (Scraping + DB Write)

```typescript
async function runIngestionPhase(
  website: Website,
  ingestionJob: ProcessJob,
  seedUrl: string
): Promise<{
  urlsDiscovered: number;
  urlsWrittenToDb: number;
  firecrawlBatchId: string;
}> {
  // 1. Map website
  const mapResult = await firecrawl.mapWebsite(seedUrl);
  if (!mapResult.success) {
    throw new Error(`Map failed: ${mapResult.error}`);
  }
  
  const discoveredUrls = filterAndNormalizeUrls(mapResult.links, website.domain);
  log.info({ count: discoveredUrls.length }, 'URLs discovered');
  
  // 2. Start batch scrape
  const batchStart = await firecrawl.batchScrapeStart(discoveredUrls);
  if (!batchStart.success) {
    throw new Error(`Batch scrape start failed: ${batchStart.error}`);
  }
  
  const batchJobId = batchStart.jobId;
  
  // 3. Poll for completion (long-running, up to 10 minutes)
  const batchResult = await firecrawl.batchScrapeWait(batchJobId, {
    pollIntervalMs: 5000,
    maxWaitMs: 600000, // 10 minutes
    onProgress: (completed, total) => {
      log.debug({ completed, total }, 'Scrape progress');
    }
  });
  
  if (!batchResult.success || !batchResult.data) {
    throw new Error(`Batch scrape failed: ${batchResult.error}`);
  }
  
  // 4. Process results and write to DB (only complete scrapes)
  let urlsWrittenToDb = 0;
  const now = new Date().toISOString();
  
  for (const item of batchResult.data) {
    // Validate completeness
    if (!item.metadata?.sourceURL) {
      log.warn({ item }, 'Missing sourceURL, skipping');
      continue;
    }
    
    if (!item.markdown || item.markdown.trim().length === 0) {
      log.warn({ url: item.metadata.sourceURL }, 'Empty markdown, skipping');
      continue; // Discard incomplete - don't write to DB
    }
    
    // Write complete scrape to DB with status='processing'
    try {
      const contentHash = computeContentHash(item.markdown);
      
      await supabase.upsertPage({
        website_id: website.id,
        url: item.metadata.sourceURL,
        path: extractPath(item.metadata.sourceURL),
        title: item.metadata.title,
        status: 'processing', // Not 'active' yet - Gemini upload pending
        markdown_content: item.markdown,
        content_hash: contentHash,
        http_status_code: item.metadata.statusCode,
        firecrawl_scrape_count: 1,
        last_seen: now,
        metadata: {
          title: item.metadata.title,
          description: item.metadata.description,
          og_image: item.metadata.ogImage,
          language: item.metadata.language
        },
        created_by_process_id: ingestionJob.id,
        firecrawl_batch_id: batchJobId
      });
      
      urlsWrittenToDb++;
    } catch (dbError) {
      log.error(
        { url: item.metadata.sourceURL, error: dbError },
        'Failed to write page to DB'
      );
      // Continue - don't fail entire process for one URL
    }
  }
  
  log.info(
    {
      discovered: discoveredUrls.length,
      scraped: batchResult.completed,
      writtenToDb: urlsWrittenToDb
    },
    'Ingestion phase complete'
  );
  
  // Update process job with batch ID
  await updateProcessJob(ingestionJob.id, {
    firecrawl_batch_ids: [batchJobId],
    urls_discovered: discoveredUrls.length,
    urls_updated: urlsWrittenToDb, // Pages written to DB
    metadata: {
      ...ingestionJob.metadata,
      urls_scraped: batchResult.completed
    }
  });
  
  return {
    urlsDiscovered: discoveredUrls.length,
    urlsWrittenToDb,
    firecrawlBatchId: batchJobId
  };
}
```

### Phase 2: Indexing (Gemini Upload + Status Promotion)

```typescript
async function runIndexingPhase(
  website: Website,
  ingestionJob: ProcessJob
): Promise<{
  pagesIndexed: number;
  errors: SyncError[];
}> {
  const errors: SyncError[] = [];
  let pagesIndexed = 0;
  const now = new Date().toISOString();
  
  // Create indexing process job
  const indexingJob = await createProcessJob({
    website_id: website.id,
    process_type: 'indexing',
    status: 'running',
    metadata: {
      ingestionJobId: ingestionJob.id
    }
  });
  
  try {
    // Get all pages with status='processing' (from Phase 1)
    // These have markdown_content but no gemini_file_id yet
    const pagesToIndex = await supabase.getPagesByWebsite(website.id, {
      status: 'processing',
      hasMarkdown: true,
      noGeminiFile: true // Only pages without gemini_file_id
    });
    
    log.info(
      { websiteId: website.id, pagesToIndex: pagesToIndex.length },
      'Pages ready for Gemini upload'
    );
    
    if (pagesToIndex.length === 0) {
      log.info({ websiteId: website.id }, 'No pages to index');
      await updateProcessJob(indexingJob.id, {
        status: 'completed',
        urls_updated: 0,
        completed_at: now
      });
      return { pagesIndexed: 0, errors: [] };
    }
    
    for (const page of pagesToIndex) {
      if (!page.markdown_content) {
        log.warn({ url: page.url }, 'Page missing markdown_content, skipping');
        continue;
      }
      
      try {
        // 1. Upload to Gemini (using stored markdown_content)
        const geminiFile = await gemini.uploadToFileSearchStore(
          website.gemini_store_id!,
          page.markdown_content,
          {
            url: page.url,
            title: page.title ?? page.url,
            path: page.path ?? extractPath(page.url),
            lastUpdated: now
          }
        );
        
        // 2. ONLY IF UPLOAD SUCCEEDS: Promote to 'active'
        await supabase.updatePage(page.id, {
          status: 'active',
          gemini_file_id: geminiFile.name,
          gemini_file_name: geminiFile.displayName,
          gemini_document_state: 'ACTIVE',
          last_scraped: now,
          error_message: null, // Clear any previous errors
          last_updated_by_process_id: indexingJob.id
        });
        
        pagesIndexed++;
        
        if (pagesIndexed % 10 === 0) {
          log.info({ pagesIndexed, total: pagesToIndex.length }, 'Indexing progress');
        }
        
      } catch (uploadError) {
        const message = uploadError instanceof Error ? uploadError.message : 'Unknown error';
        log.error({ url: page.url, error: message }, 'Failed to upload to Gemini');
        
        // Keep status='processing' but set error_message (can retry later)
        await supabase.updatePage(page.id, {
          error_message: message,
          last_updated_by_process_id: indexingJob.id
        });
        
        errors.push({
          url: page.url,
          error: message,
          timestamp: now
        });
      }
    }
    
    // Update indexing job
    await updateProcessJob(indexingJob.id, {
      status: 'completed',
      urls_updated: pagesIndexed, // Pages promoted to 'active'
      urls_errored: errors.length, // Pages still 'processing' with errors
      errors,
      completed_at: now
    });
    
    log.info(
      {
        pagesIndexed,
        errors: errors.length,
        total: pagesToIndex.length
      },
      'Indexing phase complete'
    );
    
    return { pagesIndexed, errors };
    
  } catch (error) {
    await updateProcessJob(indexingJob.id, {
      status: 'failed',
      completed_at: new Date().toISOString()
    });
    throw error;
  }
}
```

## Status Reset Implementation

```typescript
async function resetHangingStatuses(
  websiteId: string,
  resetErrorOlderThanHours: number = 24
): Promise<number> {
  log.info({ websiteId }, 'Resetting hanging statuses');
  
  // Reset processing statuses (interrupted)
  const { data: processingReset } = await supabase
    .from('pages')
    .update({
      status: 'pending',
      error_message: null,
      updated_at: new Date().toISOString()
    })
    .eq('website_id', websiteId)
    .eq('status', 'processing')
    .select();
  
  // Reset old error statuses (allow retry)
  const { data: errorReset } = await supabase
    .from('pages')
    .update({
      status: 'pending',
      error_message: null,
      updated_at: new Date().toISOString()
    })
    .eq('website_id', websiteId)
    .eq('status', 'error')
    .lt('updated_at', new Date(Date.now() - resetErrorOlderThanHours * 60 * 60 * 1000).toISOString())
    .select();
  
  const totalReset = (processingReset?.length ?? 0) + (errorReset?.length ?? 0);
  
  log.info(
    {
      websiteId,
      processingReset: processingReset?.length ?? 0,
      errorReset: errorReset?.length ?? 0,
      totalReset
    },
    'Hanging statuses reset'
  );
  
  return totalReset;
}
```

## Data Flow Example

### Scenario: 100 URLs Discovered

```
1. Map discovers 100 URLs
   └─> Stored in process_job metadata (not pages table yet)

2. Batch scrape starts
   └─> Job ID: batch_12345
   └─> Polling begins... (up to 10 minutes)

3. Batch completes
   └─> 100 URLs scraped
   └─> Results: 80 complete, 20 incomplete/empty
   └─> 20 incomplete: Discarded (never written to DB)
   └─> 80 complete: Written to DB (status='processing')

4. Indexing phase starts
   └─> Query: pages WHERE status='processing'
   └─> Process 80 pages with markdown_content
   
5. Gemini uploads
   └─> 75 succeed → Update to status='active' + gemini_file_id
   └─> 5 fail → Keep status='processing' + error_message
   
6. Final result
   └─> Database: 
       - 75 pages (status='active') ← Fully complete
       - 5 pages (status='processing') ← Can retry Gemini upload
   └─> Process job: 100 discovered, 80 scraped, 75 indexed, 5 errors
   └─> 20 incomplete scrapes: Never written (discarded)
   └─> 5 failed uploads: In DB as 'processing' (can retry without re-scraping)
```

### Crash Recovery Example

```
Process crashes after 50 Gemini uploads (out of 80):

1. On restart/resume:
   └─> Query: pages WHERE status='processing' AND gemini_file_id IS NULL
   └─> Find 30 remaining pages (80 - 50 = 30)
   
2. Resume indexing:
   └─> Upload remaining 30 pages to Gemini
   └─> Update to 'active' as they succeed
   
3. No re-scraping needed:
   └─> markdown_content already stored in DB
   └─> Just retry Gemini uploads
```

## Benefits

1. **Crash-Safe**: Process can resume from 'processing' status if interrupted
2. **No Re-Scraping**: Failed Gemini uploads can retry using stored markdown_content
3. **Clear Completion**: Only 'active' status = fully complete (scrape + Gemini)
4. **No Hanging Statuses**: Automatic reset before new processes
5. **Persistent Progress**: Scrape results stored in DB, not lost on crash
6. **Accurate Statistics**: Process jobs track true completion rates
7. **Selective Writing**: Only complete scrapes written to DB (incomplete discarded)

## Migration Strategy

1. Add status reset function to database
2. Refactor `ingestWebsite` to use two-phase approach
3. Update existing incomplete pages (optional cleanup)
4. Test with small website first
5. Monitor process job statistics

## Error Handling

- **Map fails**: Throw error, no database changes
- **Batch scrape fails**: Throw error, no database changes
- **Individual scrape incomplete**: Discard, continue to next
- **Gemini upload fails**: Log error, continue to next (don't write to DB)
- **Process interrupted**: Status reset on next run will clean up

## Monitoring

Track via `process_jobs` table:
- `urls_discovered` vs `urls_updated`: Completion rate
- `urls_errored`: Failed uploads (can retry)
- `firecrawl_batch_ids`: Link to FireCrawl jobs for debugging

