# Unit of Work Pattern Analysis

## ✅ What We Currently Have

### 1. **Per-URL Processing** ✅
- We process URLs individually in loops with try-catch
- Each URL failure doesn't break the entire sync
- **Location**: `src/services/sync.ts` lines 113-167, `src/services/ingestion.ts` lines 123-193

### 2. **Status Tracking** ✅ (Partial)
- Status enum: `'pending'`, `'active'`, `'deleted'`, `'redirect'`, `'error'`
- We mark pages as `'error'` when processing fails
- **Location**: `src/types/index.ts` line 9

### 3. **Error Handling** ✅
- Try-catch blocks around each URL processing
- Errors are logged and stored in `error_message` field
- **Location**: Multiple places in sync/ingestion services

### 4. **Database Persistence** ✅
- We store page records in Supabase
- We track `content_hash`, `gemini_file_id`, etc.

## ❌ What We're Missing (Unit of Work Pattern)

### 1. **"Processing" Status** ❌
- **Current**: We go directly from `'pending'` → `'active'` or `'error'`
- **Missing**: No intermediate `'processing'` status to track items being worked on
- **Impact**: Can't detect "stuck" items that crashed mid-process

### 2. **Database "Draft" Before Gemini Upload** ❌
- **Current Flow**: 
  1. Scrape → Get markdown
  2. Upload to Gemini → Get gemini_file_id
  3. Update DB with gemini_file_id + status='active'
  
- **Suggested Flow**:
  1. Scrape → Get markdown
  2. **Update DB FIRST** with markdown + hash + status='processing'
  3. Upload to Gemini → Get gemini_file_id
  4. Update DB with gemini_file_id + status='synced'

- **Impact**: If Gemini fails, we lose the markdown (not stored in DB)

### 3. **Retry Logic for Failed Items** ❌
- **Current**: Failed items stay in `'error'` status forever
- **Missing**: No logic to retry `'error'` or `'processing'` items on next sync
- **Impact**: Failed items never get retried automatically

### 4. **Two-Phase Commit Pattern** ❌
- **Current**: Gemini upload happens before DB update
- **Missing**: DB update first (draft), then Gemini (commit)
- **Impact**: If crash happens between Gemini upload and DB update, we lose track

## 📊 Current Flow vs Suggested Flow

### Current Flow:
```
1. Batch scrape all URLs
2. For each URL:
   ├─ Compute hash
   ├─ Upload to Gemini ← If this fails, we lose the markdown
   ├─ Update DB with gemini_file_id
   └─ Mark as 'active' or 'error'
```

### Suggested Flow (Unit of Work):
```
1. Batch scrape all URLs
2. For each URL:
   ├─ Compute hash
   ├─ Compare with existing (if exists)
   ├─ Update DB FIRST: markdown + hash + status='processing' ← Draft saved!
   ├─ Upload to Gemini
   ├─ Update DB: gemini_file_id + status='synced' ← Final commit
   └─ If Gemini fails: status='error' (but markdown is saved)

3. On next sync:
   ├─ Check for status='processing' or 'error'
   ├─ Retry those items
   └─ Process new items
```

## 🔧 What We Should Implement

### 1. Add "processing" Status
```sql
-- Update enum
ALTER TYPE page_status ADD VALUE 'processing';
```

### 2. Store Markdown in DB (Optional but Recommended)
- Add `markdown_content TEXT` column to store the markdown
- Or use `metadata` JSONB to store it temporarily
- **Note**: This might be large, so consider if needed

### 3. Implement Retry Logic
```typescript
// At start of sync:
const failedPages = await supabase.getPagesByStatus(websiteId, ['error', 'processing']);
// Retry these first before processing new items
```

### 4. Two-Phase Update Pattern
```typescript
// Phase 1: Save draft to DB
await supabase.updatePage(url, {
  content_hash: newHash,
  status: 'processing',
  // markdown_content: markdown (if storing)
});

// Phase 2: Upload to Gemini
const geminiFile = await gemini.uploadToFileSearchStore(...);

// Phase 3: Final commit
await supabase.updatePage(url, {
  gemini_file_id: geminiFile.name,
  status: 'synced', // or 'active'
});
```

## 💡 Recommendations

### High Priority:
1. ✅ Add `'processing'` status to enum
2. ✅ Implement retry logic for failed/processing items
3. ✅ Update DB with hash + status='processing' BEFORE Gemini upload

### Medium Priority:
4. Consider storing markdown in DB (if size allows)
5. Add `last_synced_at` timestamp field

### Low Priority:
6. Add retry count limit (don't retry forever)
7. Add exponential backoff for retries

