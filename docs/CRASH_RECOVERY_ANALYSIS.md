# Process Job Status Management & Crash Recovery Analysis

## Current Status Flow

```
1. Create process_job → status: 'running'
2. Store batch_job_id → status: 'running' (NEW - we just added this)
3. Wait for batch (10 min) → status: 'running'
4. Process pages → status: 'running'
5. Update final → status: 'completed' OR 'failed'
```

## Crash Scenarios & Current Behavior

### Scenario 1: Crash BEFORE batch job ID is stored
**When:** Between line 214-222 (before `updateProcessJob` for batch_id)
- **Status:** `'running'` (stuck forever)
- **Batch Job ID:** NOT stored
- **Problem:** Can't recover - no way to know what FireCrawl job was started
- **Impact:** Orphaned process_job, FireCrawl job running but untracked

### Scenario 2: Crash DURING batch scrape wait (10 minutes)
**When:** Between line 229-235 (during `batchScrapeWait`)
- **Status:** `'running'` (stuck forever)
- **Batch Job ID:** ✅ Stored (we just fixed this!)
- **Problem:** Status never updates, but we CAN recover
- **Impact:** Process_job stuck in 'running', but we have batch_id to resume

### Scenario 3: Crash DURING page processing
**When:** Between line 251-327 (processing scraped pages)
- **Status:** `'running'` (stuck forever)
- **Batch Job ID:** ✅ Stored
- **Problem:** Status never updates, partial pages written
- **Impact:** Some pages written, some not, status stuck

### Scenario 4: Crash AFTER batch completes but BEFORE final update
**When:** Between line 244-340 (after batch done, before final update)
- **Status:** `'running'` (stuck forever)
- **Batch Job ID:** ✅ Stored
- **Problem:** All pages might be written, but status never updates
- **Impact:** Work is done, but status says 'running'

### Scenario 5: Crash AFTER final update but BEFORE return
**When:** Between line 347-377 (after status='completed', before return)
- **Status:** ✅ `'completed'` (good!)
- **Problem:** None - status is correct
- **Impact:** None - job is marked complete

## Current Problems

### Problem 1: No Stuck Job Detection
- Jobs can stay `'running'` forever if process crashes
- No timeout mechanism
- No way to detect "this job has been running for 2 hours, something's wrong"

### Problem 2: No Recovery Mechanism
- Even though we store batch_job_id, there's no code to:
  - Detect stuck jobs
  - Resume from batch_job_id
  - Check FireCrawl status and update accordingly

### Problem 3: Partial Progress Lost
- If crash happens during page processing:
  - Some pages written ✅
  - Some pages not written ❌
  - Status stuck at 'running'
  - No way to know "how much is done?"

### Problem 4: No Heartbeat/Progress Updates
- During 10-minute batch wait, no progress updates to DB
- Can't tell if it's stuck or actually working
- UI can't show real progress

## Proposed Solutions

### Solution 1: Add Progress Updates During Batch Wait
**What:** Update process_job with progress during batch scrape wait
**How:** 
- In `batchScrapeWait`, use `onProgress` callback
- Every 30 seconds, update process_job with:
  - `metadata.progress = { completed, total, percentage }`
  - `updated_at` (auto-updated by trigger)
**Benefit:** UI can poll and show real progress

### Solution 2: Add Stuck Job Detection
**What:** Detect jobs that have been 'running' too long
**How:**
- Add a cleanup function that runs periodically (cron job or manual)
- Query: `SELECT * FROM process_jobs WHERE status = 'running' AND started_at < NOW() - INTERVAL '15 minutes'`
- For each stuck job:
  - If has `firecrawl_batch_ids`: Check FireCrawl status
  - If FireCrawl says 'completed': Mark job as 'completed' (recovery)
  - If FireCrawl says 'failed': Mark job as 'failed'
  - If FireCrawl says 'scraping': Update progress, keep 'running'
  - If no batch_id: Mark as 'failed' (can't recover)

### Solution 3: Add Recovery Function
**What:** Function to resume/check stuck ingestion jobs
**How:**
```typescript
export async function recoverIngestionJob(ingestionJobId: string) {
  const job = await supabase.getProcessJob(ingestionJobId);
  if (!job || job.status !== 'running') return;
  
  const batchJobId = job.firecrawl_batch_ids?.[0];
  if (!batchJobId) {
    // Can't recover - mark as failed
    await supabase.updateProcessJob(ingestionJobId, {
      status: 'failed',
      errors: [{ error: 'No batch job ID found - cannot recover', ... }]
    });
    return;
  }
  
  // Check FireCrawl status
  const status = await firecrawl.batchScrapeStatus(batchJobId);
  
  if (status.status === 'completed') {
    // Batch is done, but we crashed before processing
    // Process the results now
    await processBatchResults(job, status.data);
  } else if (status.status === 'failed') {
    await supabase.updateProcessJob(ingestionJobId, {
      status: 'failed',
      errors: [{ error: status.error || 'Batch scrape failed', ... }]
    });
  } else {
    // Still scraping - update progress
    await supabase.updateProcessJob(ingestionJobId, {
      metadata: {
        progress: {
          completed: status.completed,
          total: status.total,
          percentage: (status.completed / status.total) * 100
        }
      }
    });
  }
}
```

### Solution 4: Add Heartbeat Updates
**What:** Update `updated_at` during long operations
**How:**
- During batch wait, every 30 seconds: `UPDATE process_jobs SET updated_at = NOW() WHERE id = ?`
- This way, `updated_at` shows last activity
- Stuck jobs will have old `updated_at`

### Solution 5: Add Intermediate Status Updates
**What:** Update status at key milestones
**How:**
- After batch job ID stored: `metadata.stage = 'batch_started'`
- After batch completes: `metadata.stage = 'processing_pages'`
- After pages written: `metadata.stage = 'finalizing'`
- This helps identify WHERE the crash happened

## Recommended Implementation Plan

### Phase 1: Immediate (Critical)
1. ✅ Store batch job ID immediately (DONE)
2. Add progress updates during batch wait (update metadata every 30s)
3. Add heartbeat updates (update `updated_at` every 30s)

### Phase 2: Short-term (Important)
4. Add recovery function for stuck jobs
5. Add stuck job detection query
6. Add intermediate status updates (metadata.stage)

### Phase 3: Long-term (Nice to have)
7. Add automatic cleanup cron job
8. Add UI for viewing/recovering stuck jobs
9. Add alerts for stuck jobs

## Who Updates Status?

### Current: Only the ingestion process itself
- ✅ Success: Updates to 'completed'
- ✅ Caught error: Updates to 'failed'
- ❌ Crash: Stays 'running' forever

### Proposed: Multiple actors
1. **Ingestion process** (primary): Updates on success/failure
2. **Recovery function** (secondary): Updates stuck jobs by checking FireCrawl
3. **Cleanup cron** (tertiary): Detects and marks truly stuck jobs as 'failed'

## Database Schema Considerations

Current `process_jobs` table has:
- `status`: 'running' | 'completed' | 'failed'
- `firecrawl_batch_ids`: TEXT[] (now stored immediately)
- `metadata`: JSONB (can store progress, stage, etc.)
- `updated_at`: TIMESTAMPTZ (auto-updated by trigger)

We can use `metadata` for:
- `metadata.progress = { completed, total, percentage }`
- `metadata.stage = 'batch_started' | 'processing_pages' | 'finalizing'`
- `metadata.last_heartbeat = '2025-01-15T10:30:00Z'`

