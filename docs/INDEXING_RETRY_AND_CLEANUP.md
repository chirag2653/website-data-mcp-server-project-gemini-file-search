# Indexing Service: Retry Logic and Cleanup

## ✅ Changes Made

### 1. **Status Management** ✅
- **ACTIVE**: Only mark as `'active'` when Gemini document is ACTIVE
- **Not ACTIVE**: Keep status as `'ready_for_indexing'` (not `'processing'`) so it can be retried
- **Upload Failed**: Keep status as `'ready_for_indexing'` so it can be retried

### 2. **Document Cleanup** ✅
- **Delete incomplete uploads**: If document is not ACTIVE (PENDING/FAILED), delete it from Gemini
- **Prevents duplication**: Ensures we don't have duplicate documents when retrying
- **Clear gemini_file_id**: If document is deleted, clear `gemini_file_id` so it can be re-uploaded

---

## Complete Flow

### Success Case (Document ACTIVE)
```
1. Upload to Gemini → Upload succeeds
2. Check document state → ACTIVE ✅
3. Update page:
   - status = 'active'
   - gemini_file_id = <document-id>
   - gemini_file_name = <display-name>
4. Done! ✅
```

### Pending Case (Document PENDING)
```
1. Upload to Gemini → Upload succeeds
2. Check document state → PENDING ⏳
3. Delete document from Gemini → Prevents duplication
4. Update page:
   - status = 'ready_for_indexing' (back to ready)
   - gemini_file_id = null (cleared)
   - gemini_file_name = null (cleared)
5. Next indexing run will pick it up and retry
```

### Failed Case (Document FAILED)
```
1. Upload to Gemini → Upload succeeds
2. Check document state → FAILED ❌
3. Delete document from Gemini → Prevents duplication
4. Update page:
   - status = 'ready_for_indexing' (back to ready)
   - gemini_file_id = null (cleared)
   - error_message = 'Document processing failed in Gemini, will retry'
5. Next indexing run will pick it up and retry
```

### Upload Failed Case
```
1. Upload to Gemini → Upload fails ❌
2. Update page:
   - status = 'ready_for_indexing' (stays ready)
   - error_message = <error>
   - gemini_file_id = null (already null)
3. Next indexing run will pick it up and retry
```

---

## Key Improvements

### ✅ No Duplication
- **Before**: Incomplete uploads stayed in Gemini, causing duplicates on retry
- **After**: Incomplete uploads are deleted, preventing duplication

### ✅ Clear Retry Logic
- **Before**: Status was `'processing'` (ambiguous - could mean "processing" or "ready")
- **After**: Status is `'ready_for_indexing'` (explicit - ready to be indexed)

### ✅ Proper Cleanup
- **Before**: `gemini_file_id` was saved even for incomplete uploads
- **After**: `gemini_file_id` is only saved for ACTIVE documents, cleared for others

---

## Status Transitions

```
ready_for_indexing → (upload) → processing (temporarily)
                              ↓
                    Check Gemini state
                              ↓
                    ┌─────────┴─────────┐
                    ↓                   ↓
              ACTIVE              PENDING/FAILED
                    ↓                   ↓
                 active          ready_for_indexing
                 (done)          (retry next run)
```

---

## Code Logic

```typescript
// After upload, check document state
if (geminiState === 'ACTIVE') {
  // ✅ Success - keep document, mark as active
  finalStatus = 'active';
  shouldDeleteDocument = false;
} else {
  // ❌ Not ready - delete document, mark as ready_for_indexing
  finalStatus = 'ready_for_indexing';
  shouldDeleteDocument = true;
}

// Delete incomplete document if needed
if (shouldDeleteDocument) {
  await geminiHttp.deleteDocument(result.result.name);
}

// Update page
await supabase.updatePage(page.id, {
  status: finalStatus,
  gemini_file_id: finalStatus === 'active' ? result.result.name : null,
  gemini_file_name: finalStatus === 'active' ? result.result.displayName : null,
});
```

---

## Benefits

✅ **No Duplication**: Incomplete uploads are deleted  
✅ **Clear Status**: `'ready_for_indexing'` means ready to index  
✅ **Automatic Retry**: Failed/pending pages automatically retry  
✅ **Clean State**: `gemini_file_id` only set for ACTIVE documents  

**The indexing service now properly handles retries and cleanup!** 🎉

