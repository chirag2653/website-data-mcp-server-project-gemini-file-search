# Auto-Sync & Incomplete Pages Fix

## Changes Implemented

### 1. Auto-Sync Fallback in Ingestion ✅

**Problem:** If you tried to ingest a website that already existed, it would throw an error and fail.

**Solution:** Now automatically switches to sync mode when website already exists.

**Location:** `src/services/ingestion.ts` lines 43-62

**Behavior:**
```typescript
// Check if website already exists - if so, automatically use sync instead
const existingWebsite = await supabase.getWebsiteByDomain(domain);
if (existingWebsite) {
  log.info('Website already exists, automatically switching to sync');
  
  // Automatically run sync instead of failing
  const syncResult = await syncService.syncWebsite(existingWebsite.id);
  
  // Return result in ingestion format for compatibility
  return { ... };
}
```

**Benefits:**
- ✅ No more errors when re-running ingestion
- ✅ Automatically updates existing website
- ✅ Seamless user experience
- ✅ Handles incomplete pages from failed ingestion

### 2. Sync Handles Incomplete Pages ✅

**Problem:** Pages from failed ingestion with status 'pending', 'processing', or 'error' (missing markdown/hash) were not being handled properly.

**Solution:** Enhanced retry logic to handle all incomplete pages.

**Location:** `src/services/sync.ts` lines 58-208

**Changes:**

#### A. Include 'pending' Pages in Retry Logic
**Before:**
```typescript
const retryPages = await supabase.getPagesByStatuses(websiteId, ['processing', 'error']);
```

**After:**
```typescript
const retryPages = await supabase.getPagesByStatuses(websiteId, ['pending', 'processing', 'error']);
```

#### B. Better Handling of Missing Markdown/Hash
**Before:** Only retried if markdown existed.

**After:** 
- If markdown + hash exist → Use stored markdown (no re-scrape)
- If markdown or hash missing → Re-scrape and process

**Logic:**
```typescript
if (page.markdown_content && page.content_hash) {
  // Use stored markdown (saves FireCrawl credits)
  // Retry Gemini upload
} else {
  // Re-scrape (handles pending pages, incomplete processing, etc.)
  // Full scrape → save markdown → upload to Gemini
}
```

## How It Handles Your Scenario

### Your Situation:
- Initial ingestion ran but failed partway through
- Some pages have status: 'pending' (never scraped)
- Some pages have status: 'processing' (scraped but Gemini upload failed)
- Some pages have status: 'error' (scraped but failed before saving)
- Many pages missing `markdown_content` or `content_hash`

### What Happens Now:

#### When You Run Ingestion Again:
1. ✅ **Detects existing website** → Automatically switches to sync
2. ✅ **Sync runs** → Handles all incomplete pages

#### During Sync:

**Step 0: Retry Incomplete Pages** (NEW)
- Finds all pages with status: 'pending', 'processing', or 'error'
- For each page:
  - **Has markdown + hash?** → Use stored markdown, retry Gemini upload
  - **Missing markdown/hash?** → Re-scrape, save markdown, upload to Gemini
- Updates status to 'active' when successful

**Step 1: Discover Current URLs**
- Re-runs FireCrawl /map to get current website structure

**Step 2: Categorize URLs**
- **NEW**: URLs in map but not in DB → Scrape and index
- **EXISTING**: URLs in both → Check for changes (only 'active' pages)
- **MISSING**: URLs in DB but not in map → Increment missing_count

**Step 3-6: Process New/Changed/Missing URLs**
- Normal sync logic continues

## Example Flow

### Before Fix:
```
1. Run ingestion → Creates website, starts scraping
2. Process fails partway (timeout, error, etc.)
3. Result: 50 pages 'pending', 20 pages 'processing', 10 pages 'error'
4. Try to ingest again → ❌ ERROR: "Website already exists"
5. Must manually delete website or use sync (but sync didn't handle pending)
```

### After Fix:
```
1. Run ingestion → Creates website, starts scraping
2. Process fails partway
3. Result: 50 pages 'pending', 20 pages 'processing', 10 pages 'error'
4. Try to ingest again → ✅ Auto-switches to sync
5. Sync Step 0: Retries all 80 incomplete pages
   - Re-scrapes pending pages (no markdown)
   - Uses stored markdown for processing pages (has markdown)
   - Re-scrapes error pages (missing markdown)
6. All pages processed and indexed ✅
```

## Status Handling

### Page Statuses and How They're Handled:

| Status | Meaning | Handled By | Action |
|--------|---------|------------|--------|
| `pending` | Never scraped | Retry Logic | Re-scrape → Save markdown → Upload to Gemini |
| `processing` | Scraped, Gemini upload in progress | Retry Logic | Use stored markdown → Retry Gemini upload |
| `error` | Failed during processing | Retry Logic | Re-scrape if no markdown, or use stored markdown |
| `active` | Successfully indexed | Existing URLs Check | Check for content changes via hash comparison |
| `deleted` | Removed from website | Deletion Logic | Ignored (won't be processed) |

## Testing

To test with your existing website:

1. **Run ingestion again:**
   ```bash
   node test-ingest.js
   # or use site_ingest tool
   ```

2. **Expected behavior:**
   - Detects existing website
   - Logs: "Website already exists, automatically switching to sync"
   - Runs sync automatically
   - Processes all incomplete pages
   - Returns results in ingestion format

3. **Check logs for:**
   - "Found incomplete items to retry" (with counts)
   - "Retrying with re-scrape" (for pages without markdown)
   - "Retrying with stored markdown" (for pages with markdown)
   - "Retry successful" messages

## Benefits

✅ **No manual intervention needed** - Just re-run ingestion
✅ **Handles all incomplete states** - pending, processing, error
✅ **Saves FireCrawl credits** - Uses stored markdown when available
✅ **Self-healing** - Automatically recovers from failures
✅ **Better logging** - Shows what's being retried and why

## Files Modified

1. `src/services/ingestion.ts`:
   - Added auto-sync fallback
   - Imported sync service

2. `src/services/sync.ts`:
   - Added 'pending' to retry statuses
   - Improved retry logic to handle missing markdown/hash
   - Better logging for incomplete pages

