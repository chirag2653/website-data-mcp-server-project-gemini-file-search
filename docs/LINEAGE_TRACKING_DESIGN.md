# Lineage Tracking Design

## Overview

This system tracks the complete lineage of each page:
- **Which process** (ingestion/sync) created/updated it
- **Which FireCrawl batch job** scraped the content
- **Full audit trail** for debugging and data quality

## Database Schema

### New Table: `process_jobs`
Unified table for tracking all processes (replaces/enhances `sync_logs`):

```sql
CREATE TABLE process_jobs (
    id UUID PRIMARY KEY,
    website_id UUID REFERENCES websites(id),
    process_type process_type,  -- 'ingestion', 'sync', 'manual_reindex'
    status sync_status,  -- 'running', 'completed', 'failed'
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    urls_discovered INTEGER,
    urls_updated INTEGER,
    urls_deleted INTEGER,
    urls_errored INTEGER,
    firecrawl_batch_ids TEXT[],  -- Array of batch IDs used
    errors JSONB,
    metadata JSONB
);
```

### Updated Table: `pages`
Added lineage columns:

```sql
ALTER TABLE pages
    ADD COLUMN created_by_process_id UUID REFERENCES process_jobs(id),
    ADD COLUMN last_updated_by_process_id UUID REFERENCES process_jobs(id),
    ADD COLUMN firecrawl_batch_id TEXT;
```

## Data Flow

### Ingestion Flow:
1. Create `process_job` with `process_type='ingestion'`
2. Start FireCrawl batch scrape → get `batch_id`
3. For each page:
   - Set `created_by_process_id` = process_job.id
   - Set `firecrawl_batch_id` = batch_id
4. Update `process_job` with `firecrawl_batch_ids` array

### Sync Flow:
1. Create `process_job` with `process_type='sync'`
2. For retry pages:
   - Update `last_updated_by_process_id` = process_job.id
   - If re-scraping, set `firecrawl_batch_id` = new batch_id
3. For new pages:
   - Set `created_by_process_id` = process_job.id
   - Set `firecrawl_batch_id` = batch_id
4. For changed pages:
   - Update `last_updated_by_process_id` = process_job.id
   - Update `firecrawl_batch_id` = new batch_id
5. Update `process_job` with all `firecrawl_batch_ids` used

## Benefits

1. **Debugging**: "Why is this page in 'error' status?"
   - Check `last_updated_by_process_id` → see which sync failed
   - Check `firecrawl_batch_id` → see which batch had issues

2. **Auditing**: "When was this page last updated?"
   - Query `process_jobs` by `last_updated_by_process_id`
   - See full context of that process run

3. **Lineage**: "What batch job created this page?"
   - Direct link from page to FireCrawl batch
   - Can trace back to exact scrape operation

4. **Data Quality**: "Which ingestion run created these pages?"
   - Filter pages by `created_by_process_id`
   - Compare different ingestion runs

## Implementation Plan

### Phase 1: Database Migration ✅
- [x] Create migration file
- [x] Add process_jobs table
- [x] Add lineage columns to pages
- [x] Migrate existing sync_logs

### Phase 2: Types & Client
- [x] Add ProcessJob types
- [ ] Add process_jobs functions to Supabase client
- [ ] Update Page types with lineage fields

### Phase 3: Update Services
- [ ] Update ingestion to create process_job and track batch IDs
- [ ] Update sync to create process_job and track batch IDs
- [ ] Link pages to process_jobs

### Phase 4: Backward Compatibility
- [ ] Keep sync_logs for now (or migrate fully)
- [ ] Update queries to use process_jobs

## Migration Strategy

**Option 1: Dual Write (Recommended)**
- Write to both `sync_logs` and `process_jobs` initially
- Gradually migrate queries to `process_jobs`
- Eventually deprecate `sync_logs`

**Option 2: Full Migration**
- Migrate all existing `sync_logs` to `process_jobs`
- Update all code to use `process_jobs` only
- Remove `sync_logs` table

**Recommendation**: Option 1 for safer rollout.

