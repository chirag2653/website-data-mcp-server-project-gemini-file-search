# Indexing Service: Current Behavior Analysis

## Current Flow

### 1. **Page Selection** (No Limit)

**Location**: `src/services/indexing.ts:84-86`

```typescript
const pagesToIndex = await supabase.getPagesReadyForIndexing(websiteId, {
  processJobId: ingestionJobId,
  // NO limit parameter - loads ALL pages
});
```

**Behavior**:
- ✅ Loads **ALL** pages with `status='processing'` that match criteria
- ❌ **No limit** - if there are 1000 pages, it loads all 1000 into memory
- ❌ **No pagination** - single query loads everything
- ✅ Orders by `updated_at` (oldest first)

**Example**:
- 100 URLs → Loads all 100
- 1000 URLs → Loads all 1000
- 10000 URLs → Loads all 10000 (⚠️ memory issue)

---

### 2. **Upload Processing** (Batches of 5, but all in memory)

**Location**: `src/services/indexing.ts:117-170`

```typescript
// Prepare ALL pages as batch items (all in memory)
const batchItems = pagesToIndex
  .filter(page => page.markdown_content)
  .map(page => ({ id, content, metadata }));

// Upload ALL items in batches of 5
const batchResults = await geminiHttp.uploadFilesInBatches(
  geminiStoreId,
  batchItems,  // ALL items passed at once
  { batchSize: 5 }
);
```

**Behavior**:
- ✅ Processes uploads in **batches of 5** (5 parallel API calls)
- ❌ But **all items are in memory** before processing starts
- ✅ `uploadFilesInBatches()` processes them in chunks:
  - Batch 1: Items 0-4 (5 parallel)
  - Batch 2: Items 5-9 (5 parallel)
  - Batch 3: Items 10-14 (5 parallel)
  - ... and so on

**Example with 100 pages**:
- Loads all 100 pages into memory
- Processes in 20 batches (100 ÷ 5 = 20 batches)
- Each batch: 5 parallel uploads
- Total: 100 API calls (20 batches × 5 parallel)

**Example with 1000 pages**:
- Loads all 1000 pages into memory ⚠️
- Processes in 200 batches (1000 ÷ 5 = 200 batches)
- Each batch: 5 parallel uploads
- Total: 1000 API calls (200 batches × 5 parallel)

---

### 3. **Database Updates** (Individual writes after ALL uploads complete)

**Location**: `src/services/indexing.ts:176-263`

```typescript
// After ALL uploads complete, loop through ALL results
for (const result of batchResults) {
  // Update EACH page individually (sequential, one-by-one)
  await supabase.updatePage(page.id, {
    status: finalStatus,
    gemini_file_id: result.result.name,
    // ... other fields
  });
}

// Finally update process job (after ALL pages updated)
await supabase.updateProcessJob(indexingJob.id, {
  status: 'completed',
  urls_updated: pagesIndexed,
});
```

**Behavior**:
- ❌ **Sequential updates** - writes each page one-by-one
- ❌ **After ALL uploads complete** - doesn't write during upload
- ❌ **No batching** - each `updatePage()` is a separate database call
- ✅ Finally updates process job after all pages are updated

**Example with 100 pages**:
- Upload all 100 pages (20 batches of 5)
- Wait for ALL uploads to complete
- Then write 100 individual `updatePage()` calls (sequential)
- Finally update process job

**Example with 1000 pages**:
- Upload all 1000 pages (200 batches of 5)
- Wait for ALL uploads to complete
- Then write 1000 individual `updatePage()` calls (sequential) ⚠️
- Finally update process job

---

## Complete Flow Example: 100 URLs

```
1. Query: Load ALL 100 pages (status='processing')
   → Memory: 100 pages loaded

2. Prepare: Convert all 100 to batch items
   → Memory: 100 batch items

3. Upload: Process in batches of 5
   → Batch 1: Upload 5 pages (parallel)
   → Batch 2: Upload 5 pages (parallel)
   → ...
   → Batch 20: Upload 5 pages (parallel)
   → Total: 100 uploads complete

4. Wait: All uploads complete, get all results
   → Memory: 100 results

5. Update Database: Loop through all 100 results
   → Update page 1 (await)
   → Update page 2 (await)
   → ...
   → Update page 100 (await)
   → Total: 100 sequential database writes

6. Update Process Job: Final update
   → 1 database write
```

**Total Operations**:
- 1 query (load all pages)
- 100 uploads (20 batches of 5)
- 100 database updates (sequential)
- 1 process job update
- **Total: 202 operations**

---

## Complete Flow Example: 1000 URLs

```
1. Query: Load ALL 1000 pages
   → Memory: 1000 pages loaded ⚠️

2. Prepare: Convert all 1000 to batch items
   → Memory: 1000 batch items ⚠️

3. Upload: Process in batches of 5
   → 200 batches × 5 parallel = 1000 uploads
   → Time: ~200 batches × (upload time + 500ms pause)

4. Wait: All uploads complete
   → Memory: 1000 results ⚠️

5. Update Database: Loop through all 1000 results
   → 1000 sequential database writes ⚠️
   → Time: 1000 × (database write time)

6. Update Process Job: Final update
```

**Total Operations**:
- 1 query (load all pages)
- 1000 uploads (200 batches of 5)
- 1000 database updates (sequential)
- 1 process job update
- **Total: 2002 operations**

**Issues**:
- ⚠️ High memory usage (1000 pages in memory)
- ⚠️ Slow database updates (1000 sequential writes)
- ⚠️ No progress persistence (if crashes, lose all progress)

---

## Summary

### Current Behavior

| Aspect | Current Implementation |
|--------|----------------------|
| **Page Selection** | Loads ALL pages (no limit) |
| **Upload Processing** | Batches of 5, but all items in memory |
| **Database Updates** | Individual writes after ALL uploads complete |
| **Progress Tracking** | Only in memory, not persisted |

### Issues for Large Datasets

1. **Memory**: All pages loaded into memory at once
2. **Database Writes**: Sequential, one-by-one after all uploads
3. **No Progress Persistence**: If crashes, lose all progress
4. **No Incremental Updates**: Can't see progress until all complete

### What Works Well

1. ✅ Batch upload processing (5 parallel)
2. ✅ Rate limit handling
3. ✅ Error isolation (one failure doesn't stop others)
4. ✅ State verification (checks document state)

---

## Recommendations

### Option 1: Add Limit (Simple)
- Add `limit` parameter to `getPagesReadyForIndexing()`
- Process in chunks (e.g., 100 at a time)
- Run multiple indexing runs if needed

### Option 2: Incremental Updates (Better)
- Update database after each batch completes
- Persist progress incrementally
- Can resume if interrupted

### Option 3: Batch Database Updates (Best)
- Collect all updates in memory
- Use batch update API (if available)
- Or use transactions for multiple updates

