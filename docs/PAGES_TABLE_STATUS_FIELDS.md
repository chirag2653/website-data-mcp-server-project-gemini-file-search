# Pages Table: Status Fields Explained

## Two Different "Active" Fields

The `pages` table has **two separate fields** that both relate to "active" status, but serve different purposes:

---

## 1. `status` (lowercase) - **Page Status in Our System**

**Type**: `page_status` enum (PostgreSQL)

**Values**:
- `'pending'` - Page discovered but not yet scraped
- `'processing'` - Page scraped, markdown stored, but not yet indexed (or indexing in progress)
- `'active'` - ✅ **Page is fully indexed and ready for querying**
- `'deleted'` - Page was deleted from website
- `'redirect'` - Page is a redirect
- `'error'` - Page has an error

**Used By**: Indexing service to track page lifecycle

**Relevant to Indexing**: ✅ **YES - This is the main field**

**How Indexing Uses It**:
```typescript
// When document is ACTIVE in Gemini:
await supabase.updatePage(page.id, {
  status: 'active',  // ← Lowercase 'active'
  gemini_document_state: 'ACTIVE',
});
```

**Query Pattern**:
```sql
-- Get pages ready for indexing
WHERE status = 'processing'  -- Lowercase
  AND markdown_content IS NOT NULL
  AND gemini_file_id IS NULL

-- Get indexed pages
WHERE status = 'active'  -- Lowercase
```

---

## 2. `gemini_document_state` (uppercase) - **Document State in Gemini**

**Type**: `gemini_document_state` enum (PostgreSQL)

**Values**:
- `'PROCESSING'` - Document is being processed (embeddings generated)
- `'ACTIVE'` - ✅ **Document is ready for querying in Gemini**
- `'FAILED'` - Document processing failed

**Used By**: Tracks what Gemini reports as the document state

**Relevant to Indexing**: ⚠️ **Reference only** - Used to determine when to set `status='active'`

**How Indexing Uses It**:
```typescript
// Check Gemini document state
const document = await geminiHttp.getDocument(result.result.name);
const geminiState = document.state?.toUpperCase();

if (geminiState === 'ACTIVE') {
  // Gemini says document is ready
  actualDocumentState = 'ACTIVE';  // ← Uppercase 'ACTIVE'
  finalStatus = 'active';           // ← Lowercase 'active' for our status field
}
```

**Query Pattern**:
```sql
-- Find documents still processing in Gemini
WHERE gemini_document_state = 'PROCESSING'

-- Find documents ready in Gemini
WHERE gemini_document_state = 'ACTIVE'
```

---

## Key Differences

| Field | Case | Purpose | Values | Used By |
|-------|------|---------|--------|---------|
| `status` | **lowercase** | Page lifecycle in our system | `'active'`, `'processing'`, `'pending'`, etc. | ✅ **Indexing service** |
| `gemini_document_state` | **UPPERCASE** | Document state in Gemini API | `'ACTIVE'`, `'PROCESSING'`, `'FAILED'` | Reference only |

---

## How They Work Together

### Flow Example:

```
1. Page scraped → status='processing', gemini_document_state=NULL

2. Upload to Gemini → status='processing', gemini_document_state='PROCESSING'
   (Document uploaded but embeddings still being generated)

3. Check Gemini state → gemini_document_state='ACTIVE'
   → Update: status='active', gemini_document_state='ACTIVE'
   ✅ Page is now fully indexed and ready!
```

### Code Logic:

```typescript
// 1. Upload succeeds
const result = await uploadToFileSearchStore(...);

// 2. Check actual Gemini state
const document = await geminiHttp.getDocument(result.name);
const geminiState = document.state; // 'ACTIVE', 'PENDING', or 'FAILED'

// 3. Update both fields
if (geminiState === 'ACTIVE') {
  await supabase.updatePage(page.id, {
    status: 'active',                    // ← Our system status (lowercase)
    gemini_document_state: 'ACTIVE',     // ← Gemini state (uppercase)
  });
} else {
  // Keep as processing, will retry
  await supabase.updatePage(page.id, {
    status: 'processing',                // ← Still processing
    gemini_document_state: 'PROCESSING', // ← Still processing in Gemini
  });
}
```

---

## Which One is Relevant to Indexing?

### ✅ `status` (lowercase) - **PRIMARY FIELD**

This is the **main field** the indexing service uses:
- ✅ Used to query pages ready for indexing: `WHERE status='processing'`
- ✅ Used to mark pages as complete: `status='active'`
- ✅ Used to track page lifecycle
- ✅ This is what matters for the indexing service

### 📊 `gemini_document_state` (uppercase) - **REFERENCE FIELD**

This is a **reference field** that tracks Gemini's state:
- ⚠️ Used to determine when to set `status='active'`
- ⚠️ Used for debugging and monitoring
- ⚠️ Not used in queries (status is used instead)
- ⚠️ Just tracks what Gemini reports

---

## Current Database State

From query results:
```sql
SELECT status, gemini_document_state, COUNT(*) 
FROM pages 
GROUP BY status, gemini_document_state;

Result:
  status='active', gemini_document_state='ACTIVE', count=52
```

This shows:
- ✅ 52 pages are fully indexed (`status='active'`)
- ✅ All 52 have `gemini_document_state='ACTIVE'` (consistent)
- ✅ Both fields are in sync (as expected)

---

## Summary

**For Indexing Service**:
- ✅ Use `status='active'` (lowercase) to mark pages as complete
- ✅ Use `status='processing'` (lowercase) for pages being indexed
- ✅ Use `gemini_document_state` (uppercase) only to check when to set status

**The indexing service is correctly using both fields!**

