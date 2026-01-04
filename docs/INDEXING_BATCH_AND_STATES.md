# Indexing Service: Batch Upload & State Management

## Batch Upload Implementation

### ⚠️ Important: No Batch API Endpoint

**Question**: Is batch upload 5 different API calls or a single batch endpoint?

**Answer**: **5 separate API calls processed in parallel**

The Gemini File Search API does **NOT** have a batch upload endpoint. Our `uploadFilesInBatches()` function:
- Processes 5 uploads **concurrently** using `Promise.all()`
- Each upload is a **separate API call** to: `POST /upload/v1beta/{store}:uploadToFileSearchStore`
- This is **parallel processing**, not a true batch API

### How It Works

```typescript
// Process 5 uploads in parallel (not a single batch call)
const batchPromises = batch.map(async (item) => {
  // Each is a separate API call
  return await uploadToFileSearchStore(storeName, item.content, item.metadata);
});

await Promise.all(batchPromises); // Wait for all 5 to complete
```

### Benefits

- ✅ Faster than sequential uploads (5x speedup)
- ✅ Rate limit handling (429 errors with retry)
- ✅ Progress tracking
- ✅ Error isolation (one failure doesn't stop others)

### Limitations

- ⚠️ Each upload is a separate API call (counts toward rate limits)
- ⚠️ No atomic batch operation (some may succeed, others fail)
- ⚠️ Rate limits apply per call (15 RPM on free tier)

---

## State Management (Per API Documentation)

### API States

According to [Gemini API Documentation](https://ai.google.dev/api/file-search/documents#endpoint):

| State | Description | Our Action |
|-------|-------------|------------|
| `STATE_PENDING` | Some Chunks are being processed (embedding and vector storage) | Keep `status='processing'` |
| `STATE_ACTIVE` | All Chunks are processed and available for querying | Update to `status='active'` ✅ |
| `STATE_FAILED` | Some Chunks failed processing | Keep `status='processing'` |

### State Flow

```
Upload Complete → Verify Document State → Update Status:

1. ACTIVE (STATE_ACTIVE)
   → status='active' ✅
   → gemini_document_state='ACTIVE'
   → Count as indexed
   → Ready for querying

2. PENDING (STATE_PENDING)
   → status='processing' (keep)
   → gemini_document_state='PROCESSING'
   → NOT counted as indexed
   → Will be picked up in next indexing run

3. FAILED (STATE_FAILED)
   → status='processing' (keep)
   → gemini_document_state='FAILED'
   → error_message='Document processing failed in Gemini'
   → NOT counted as indexed
   → Will be picked up in next indexing run
```

### Implementation Logic

```typescript
// 1. Upload succeeds → get document name
// 2. Verify actual state from Gemini API
const document = await geminiHttp.getDocument(documentName);

// 3. Only update to 'active' if state is ACTIVE
if (document.state === 'ACTIVE' || document.state === 'STATE_ACTIVE') {
  // ✅ Document is completely done - mark as active
  await supabase.updatePage(page.id, {
    status: 'active',
    gemini_document_state: 'ACTIVE',
  });
  pagesIndexed++; // Count as indexed
} else {
  // ⏳ PENDING or FAILED - keep as processing
  await supabase.updatePage(page.id, {
    status: 'processing', // Keep so it gets picked up next run
    gemini_document_state: document.state === 'FAILED' ? 'FAILED' : 'PROCESSING',
  });
  // NOT counted as indexed - will retry next run
}
```

### Key Rules

1. **Only ACTIVE = Complete**: Only mark as `'active'` when document state is `ACTIVE`
2. **PENDING = Still Processing**: Keep `status='processing'` so it gets picked up next run
3. **FAILED = Retry**: Keep `status='processing'` with error message for retry
4. **Always Verify**: Check actual document state from API, don't trust upload result

---

## Retry Logic

### Pages That Get Retried

Pages with `status='processing'` and `gemini_file_id` set will be picked up in next indexing run:

```sql
-- Query in getPagesReadyForIndexing()
WHERE status = 'processing'
  AND markdown_content IS NOT NULL
  AND gemini_file_id IS NOT NULL  -- Upload succeeded, but state not ACTIVE
```

### Example Retry Scenario

```
Run 1:
  - Upload 100 pages
  - 60 → ACTIVE (marked as 'active')
  - 30 → PENDING (kept as 'processing')
  - 10 → FAILED (kept as 'processing')

Run 2:
  - Query: pages with status='processing' AND gemini_file_id IS NOT NULL
  - Check state of 40 pages (30 PENDING + 10 FAILED)
  - 25 → Now ACTIVE (update to 'active')
  - 15 → Still PENDING/FAILED (keep as 'processing')

Run 3:
  - Continue until all are ACTIVE or manually handled
```

---

## Summary

### Batch Upload
- ✅ 5 parallel API calls (not a single batch endpoint)
- ✅ Faster than sequential
- ✅ Rate limit handling included

### State Management
- ✅ Only mark as 'active' when state is ACTIVE
- ✅ PENDING/FAILED → keep as 'processing' for next run
- ✅ Always verify document state from API
- ✅ Proper retry logic for incomplete documents

