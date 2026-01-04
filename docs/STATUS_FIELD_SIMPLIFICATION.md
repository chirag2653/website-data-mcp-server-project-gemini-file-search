# Status Field Simplification

## Changes Made

### ✅ Removed `gemini_document_state` from Pages Table

**Before**: Pages table had two status-related fields:
- `status` (lowercase) - Page lifecycle in our system
- `gemini_document_state` (uppercase) - Document state in Gemini

**After**: Pages table has only ONE status field:
- `status` (lowercase) - Complete page lifecycle

### ✅ Moved Document States to Process Jobs

**New Location**: `process_jobs.metadata.documentStates`

Since indexing is asynchronous (like ingestion), Gemini document states are now tracked in the process job metadata, not in the pages table.

---

## Complete Lifecycle (Single Status Field)

### Status Values

| Status | Meaning | When Set |
|--------|---------|----------|
| `'pending'` | Page discovered, not scraped yet | Initial discovery |
| `'processing'` | Page scraped, markdown stored, ready for indexing OR indexing in progress | After scrape OR during indexing |
| `'active'` | ✅ Page fully indexed and ready for querying | When Gemini document is ACTIVE |
| `'deleted'` | Page deleted from website | Sync detects deletion |
| `'redirect'` | Page is a redirect | Scrape detects redirect |
| `'error'` | Page has an error | Scrape/upload fails |

### Lifecycle Flow

```
1. Discovery → status='pending'
2. Scrape → status='processing' (markdown stored)
3. Indexing starts → status='processing' (still processing)
4. Upload to Gemini → status='processing' (document uploaded)
5. Gemini processing → status='processing' (embeddings being generated)
6. Gemini ACTIVE → status='active' ✅ (ready for querying)
```

---

## Document States Tracking

### Location: `process_jobs.metadata.documentStates`

**Format**:
```json
{
  "ingestionJobId": "uuid",
  "documentStates": {
    "page-id-1": "ACTIVE",
    "page-id-2": "PROCESSING",
    "page-id-3": "FAILED"
  },
  "activeCount": 60,
  "processingCount": 15,
  "failedCount": 5
}
```

**Why Process Jobs?**
- Indexing is asynchronous (like ingestion)
- Multiple pages processed in one job
- States are temporary (PROCESSING → ACTIVE)
- Process jobs already track async operations

**Benefits**:
- ✅ Simpler pages table (one status field)
- ✅ States tracked where they belong (process tracking)
- ✅ Better debugging (see all states for a job)
- ✅ Consistent with ingestion pattern

---

## Code Changes

### 1. Removed from Types

**Before**:
```typescript
export interface Page {
  // ...
  gemini_document_state: GeminiDocumentState | null;
}

export interface PageUpdate {
  // ...
  gemini_document_state?: GeminiDocumentState | null;
}
```

**After**:
```typescript
export interface Page {
  // ...
  // gemini_document_state removed
}

export interface PageUpdate {
  // ...
  // gemini_document_state removed
}
```

### 2. Updated Indexing Service

**Before**:
```typescript
await supabase.updatePage(page.id, {
  status: finalStatus,
  gemini_document_state: actualDocumentState, // ← Removed
});
```

**After**:
```typescript
// Track in process job metadata
documentStates[page.id] = actualDocumentState;

await supabase.updatePage(page.id, {
  status: finalStatus, // ← Only status field
});

// Update process job with states
await supabase.updateProcessJob(indexingJob.id, {
  metadata: {
    documentStates, // ← States tracked here
    activeCount: ...,
    processingCount: ...,
    failedCount: ...,
  },
});
```

---

## Query Patterns

### Get Pages Ready for Indexing

```sql
-- Pages with markdown but not indexed
WHERE status = 'processing'
  AND markdown_content IS NOT NULL
  AND gemini_file_id IS NULL
```

### Get Indexed Pages

```sql
-- Fully indexed and ready
WHERE status = 'active'
```

### Get Document States (from Process Job)

```sql
-- Get document states for an indexing job
SELECT metadata->'documentStates' as document_states
FROM process_jobs
WHERE id = 'indexing-job-id'
  AND process_type = 'indexing'
```

---

## Migration Notes

### Existing Data

- Existing `gemini_document_state` values in pages table will be ignored
- No data migration needed (field can be dropped from schema later)
- New indexing runs will track states in process_jobs only

### Database Schema

The `gemini_document_state` column can be dropped from the pages table in a future migration:
```sql
ALTER TABLE pages DROP COLUMN gemini_document_state;
```

But it's not urgent - the code no longer uses it.

---

## Summary

✅ **Simplified**: One status field covers entire lifecycle  
✅ **Moved**: Document states tracked in process_jobs.metadata  
✅ **Consistent**: Same pattern as ingestion (async states in process jobs)  
✅ **Cleaner**: Pages table focuses on page lifecycle, not process details

