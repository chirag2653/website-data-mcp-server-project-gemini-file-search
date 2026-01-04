# Completeness Check Flow - Per URL Validation

## Exact Flow After Batch Scrape Completes

### **Step 1: Receive All Data**
```typescript
const scrapedData = scrapeResult.data ?? [];
// scrapedData = [
//   { markdown: "...", metadata: { sourceURL: "url1", ... } },
//   { markdown: "...", metadata: { sourceURL: "url2", ... } },
//   ... all 52 URLs
// ]
```

### **Step 2: Loop Through Each URL**
```typescript
for (const pageData of scrapedData) {
  // Process each URL one by one
}
```

### **Step 3: Check Completeness Per URL**

For **EACH URL**, we check:

**Check 1: URL exists?**
```typescript
const url = pageData.metadata?.sourceURL;
if (!url) {
  log.warn('Page missing sourceURL, skipping (discarded)');
  continue; // ❌ SKIP - Don't write
}
```

**Check 2: Markdown exists and is valid?**
```typescript
if (!pageData.markdown || typeof pageData.markdown !== 'string') {
  log.warn('Page missing markdown, skipping (discarded)');
  continue; // ❌ SKIP - Don't write
}
```

**Check 3: Markdown is not empty?**
```typescript
const trimmedMarkdown = pageData.markdown.trim();
if (trimmedMarkdown.length === 0) {
  log.warn('Empty markdown, skipping (discarded)');
  continue; // ❌ SKIP - Don't write
}
```

### **Step 4: If Complete → Write in One Shot**

**If ALL checks pass:**
```typescript
// ✅ URL has complete data
// Prepare all fields
const contentHash = computeContentHash(pageData.markdown);
const path = extractPath(url);
const httpStatusCode = pageData.metadata?.statusCode ?? null;

// ✅ Write ALL data in ONE atomic operation
await supabase.upsertPage({
  website_id: website.id,
  url,
  path,
  title: pageData.metadata?.title,
  status: 'processing',
  content_hash: contentHash,
  markdown_content: pageData.markdown,  // ✅ Complete markdown
  http_status_code: httpStatusCode,
  firecrawl_scrape_count: 1,
  last_seen: now,
  metadata: { ... },
  created_by_ingestion_id: ingestionJob.id,
  firecrawl_batch_id: batchJobId,
});

pagesWritten++; // ✅ Count as written
```

---

## Flow Diagram

```
Batch Complete → All 52 URLs' data in memory
  ↓
Loop: For each URL in data
  ↓
  Check 1: URL exists?
    ├─ NO → Skip (discard) ❌
    └─ YES → Continue
  ↓
  Check 2: Markdown exists?
    ├─ NO → Skip (discard) ❌
    └─ YES → Continue
  ↓
  Check 3: Markdown not empty?
    ├─ NO → Skip (discard) ❌
    └─ YES → Continue
  ↓
  ✅ ALL CHECKS PASSED
  ↓
  Prepare all data (hash, path, etc.)
  ↓
  Write to DB in ONE atomic operation ✅
  ↓
  Next URL...
```

---

## Example Scenario

**Batch returns 52 URLs:**

```
URL 1: ✅ Has URL, ✅ Has markdown, ✅ Not empty → WRITE ✅
URL 2: ✅ Has URL, ✅ Has markdown, ✅ Not empty → WRITE ✅
URL 3: ✅ Has URL, ❌ No markdown → SKIP (discard) ❌
URL 4: ✅ Has URL, ✅ Has markdown, ❌ Empty after trim → SKIP (discard) ❌
URL 5: ✅ Has URL, ✅ Has markdown, ✅ Not empty → WRITE ✅
...
URL 52: ✅ Has URL, ✅ Has markdown, ✅ Not empty → WRITE ✅
```

**Result:**
- 50 URLs written to DB ✅
- 2 URLs discarded ❌
- Database only has complete rows ✅

---

## Key Points

1. ✅ **Completeness check happens PER URL** (not for all at once)
2. ✅ **Each URL is validated individually** before writing
3. ✅ **If complete → Write in ONE atomic operation** (all fields together)
4. ✅ **If incomplete → Skip entirely** (never written to DB)
5. ✅ **No partial writes** - either complete row or no row

---

## Code Location

**File:** `src/services/ingestion.ts`  
**Lines:** 211-280

**Validation:** Lines 214-235  
**Data Preparation:** Lines 242-247  
**Atomic Write:** Lines 254-280

