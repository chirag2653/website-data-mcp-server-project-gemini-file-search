# Lineage Tracking - Clear Ingestion/Sync Separation

## Design Principles

1. **Clear Separation**: Ingestion and Sync are distinct processes with separate IDs
2. **Website Lineage**: Each website tracks which ingestion created it
3. **Page Lineage**: Each page tracks:
   - Which ingestion created it (if created during initial ingestion)
   - Which sync created it (if added during sync)
   - Which sync last updated it
   - Which FireCrawl batch scraped it

## Database Schema

### Websites Table
```sql
ALTER TABLE websites
    ADD COLUMN created_by_ingestion_id UUID REFERENCES process_jobs(id);
```

**Purpose**: Track which ingestion process first created this website.

### Pages Table
```sql
ALTER TABLE pages
    ADD COLUMN created_by_ingestion_id UUID REFERENCES process_jobs(id),  -- If created during ingestion
    ADD COLUMN created_by_sync_id UUID REFERENCES process_jobs(id),      -- If created during sync
    ADD COLUMN last_updated_by_sync_id UUID REFERENCES process_jobs(id), -- Last sync that updated it
    ADD COLUMN firecrawl_batch_id TEXT;                                   -- FireCrawl batch that scraped it
```

**Purpose**: 
- `created_by_ingestion_id`: Set when page is created during initial ingestion
- `created_by_sync_id`: Set when page is discovered and added during sync
- `last_updated_by_sync_id`: Updated every time sync modifies the page
- `firecrawl_batch_id`: Tracks which FireCrawl batch job scraped the content

## Process Flow

### Ingestion Process

1. **Create Process Job**:
   ```typescript
   const ingestionJob = await createProcessJob({
     website_id: website.id,
     process_type: 'ingestion',
     status: 'running'
   });
   ```

2. **Create Website**:
   ```typescript
   const website = await createWebsite({
     ...websiteData,
     created_by_ingestion_id: ingestionJob.id
   });
   ```

3. **Create Pages**:
   ```typescript
   await upsertPages(pages.map(page => ({
     ...page,
     created_by_ingestion_id: ingestionJob.id,
     firecrawl_batch_id: batchId
   })));
   ```

4. **Update Process Job**:
   ```typescript
   await updateProcessJob(ingestionJob.id, {
     status: 'completed',
     urls_discovered: pages.length,
     urls_updated: pagesIndexed,
     firecrawl_batch_ids: [batchId]
   });
   ```

### Sync Process

1. **Create Process Job**:
   ```typescript
   const syncJob = await createProcessJob({
     website_id: website.id,
     process_type: 'sync',
     status: 'running'
   });
   ```

2. **For New Pages** (discovered during sync):
   ```typescript
   await upsertPages(newPages.map(page => ({
     ...page,
     created_by_sync_id: syncJob.id,  // Created during sync
     firecrawl_batch_id: batchId
   })));
   ```

3. **For Updated Pages**:
   ```typescript
   await updatePage(pageId, {
     ...updates,
     last_updated_by_sync_id: syncJob.id,  // Updated during sync
     firecrawl_batch_id: newBatchId
   });
   ```

4. **Update Process Job**:
   ```typescript
   await updateProcessJob(syncJob.id, {
     status: 'completed',
     urls_discovered: newUrls.length,
     urls_updated: updatedUrls.length,
     firecrawl_batch_ids: [batchId1, batchId2, ...]
   });
   ```

## Query Examples

### Find all pages from a specific ingestion:
```sql
SELECT * FROM pages 
WHERE created_by_ingestion_id = 'ingestion-uuid';
```

### Find all pages added during a specific sync:
```sql
SELECT * FROM pages 
WHERE created_by_sync_id = 'sync-uuid';
```

### Find all pages updated by a specific sync:
```sql
SELECT * FROM pages 
WHERE last_updated_by_sync_id = 'sync-uuid';
```

### Find website and its initial ingestion:
```sql
SELECT w.*, pj.* 
FROM websites w
JOIN process_jobs pj ON w.created_by_ingestion_id = pj.id
WHERE w.id = 'website-uuid';
```

### Find all syncs for a website:
```sql
SELECT * FROM process_jobs
WHERE website_id = 'website-uuid'
  AND process_type = 'sync'
ORDER BY started_at DESC;
```

## Benefits

1. **Clear Lineage**: Know exactly which process created/updated each page
2. **Debugging**: "Why is this page in error?" → Check `last_updated_by_sync_id` → See sync details
3. **Auditing**: Track all changes to a page through sync history
4. **Data Quality**: Compare pages from different ingestion runs
5. **FireCrawl Tracking**: Know which batch job scraped each page

## Implementation Status

✅ **Database Migration**: Created with clear separation
✅ **TypeScript Types**: Updated with separate ingestion/sync fields
✅ **Supabase Client**: Process job functions ready
⏳ **Ingestion Service**: Needs to create process_job and link pages
⏳ **Sync Service**: Needs to create process_job and link pages

