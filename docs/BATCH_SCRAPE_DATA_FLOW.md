# FireCrawl Batch Scrape - Data Flow Explanation

## How Batch Scrape Works

### **Step 1: Start Batch Scrape**
```typescript
const batchStart = await firecrawl.batchScrapeStart(discoveredUrls);
// Returns: { success: true, jobId: "..." }
```

**What happens:**
- Sends all URLs to FireCrawl API: `POST /v2/batch/scrape`
- FireCrawl starts scraping in the background
- Returns immediately with a `jobId`
- **No data returned yet** - just a job ID

**Memory:** Only jobId stored (string)

---

### **Step 2: Poll for Status (Wait for Completion)**
```typescript
const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
  pollIntervalMs: 5000,  // Poll every 5 seconds
  maxWaitMs: 600000,     // Max 10 minutes
});
```

**What happens:**
- Polls FireCrawl API: `GET /v2/batch/scrape/{jobId}` every 5 seconds
- Each poll returns:
  ```typescript
  {
    status: 'scraping' | 'completed' | 'failed',
    completed: 5,      // How many URLs done
    total: 52,         // Total URLs
    data: undefined    // ❌ NO DATA YET (while scraping)
  }
  ```
- While `status === 'scraping'`: **No data returned** - just progress
- When `status === 'completed'`: **ALL data returned at once**

**Memory during polling:** Only status/progress (small objects)

---

### **Step 3: Batch Complete - Get ALL Data**
```typescript
// When status === 'completed', FireCrawl returns:
{
  status: 'completed',
  completed: 52,
  total: 52,
  data: [              // ✅ ALL DATA ARRIVES AT ONCE
    { markdown: "...", metadata: {...} },  // URL 1
    { markdown: "...", metadata: {...} },  // URL 2
    // ... all 52 URLs
  ]
}
```

**Key Point:** FireCrawl returns **ALL scraped data in one response** when batch completes.

**Memory:** Entire `scrapeResult.data` array (all URLs) stored in memory

---

### **Step 4: Process and Write to Database**
```typescript
const scrapedData = scrapeResult.data ?? [];  // All data in memory

for (const pageData of scrapedData) {
  // Validate each page
  // Write to DB (one row at a time)
}
```

**What happens:**
- We iterate through the `scrapedData` array (all URLs in memory)
- For each URL:
  1. Validate (markdown exists, not empty)
  2. Compute hash
  3. Write to Supabase (one atomic write per URL)

**Memory:** All scraped data stays in memory until we finish writing

---

## Answer to Your Questions

### **Q: Does Batch give you data per URL or all at once?**
**A: ALL AT ONCE** ✅

- FireCrawl batch scrape returns **all URLs' data in one response** when status is 'completed'
- The `data` array contains all scraped pages: `[{url1}, {url2}, ..., {url52}]`
- We get nothing during polling - only when batch completes

### **Q: Do we keep it in memory?**
**A: YES** ✅

- After batch completes, `scrapeResult.data` contains all scraped pages in memory
- We keep it in memory while we iterate and write to database
- Memory is freed after we finish writing all rows

### **Q: When do we start writing rows?**
**A: AFTER BATCH COMPLETES** ✅

- We **do NOT write during polling**
- We **wait for entire batch to complete**
- Once `status === 'completed'` and we have `scrapeResult.data`, we start writing
- We write rows one by one, but all data is already in memory

---

## Memory Flow Diagram

```
1. batchScrapeStart()
   Memory: jobId (string) ✅ Small

2. batchScrapeWait() - Polling
   Memory: status object (completed: 5, total: 52) ✅ Small
   Data: undefined ❌

3. Batch Completes
   Memory: scrapeResult.data = [all 52 URLs] ✅ Large (all data)
   
4. Writing to DB
   Memory: Still holding all 52 URLs ✅
   Writing: One row at a time
   
5. After Writing Complete
   Memory: Freed (garbage collected) ✅
```

---

## Current Implementation

**Location:** `src/services/ingestion.ts` (lines 188-209)

```typescript
// Wait for batch to complete (polling)
const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {...});

// ✅ Batch complete - ALL data in scrapeResult.data
if (!scrapeResult.success || !scrapeResult.data) {
  throw new Error('Batch scrape failed');
}

// ✅ All data in memory now
const scrapedData = scrapeResult.data ?? [];

// ✅ Start writing rows (one by one)
for (const pageData of scrapedData) {
  // Validate
  // Write to DB
}
```

---

## Summary

- **Batch returns ALL data at once** when complete (not per URL)
- **Data is kept in memory** during the write process
- **Writing starts AFTER batch completes** (not during polling)
- **One atomic write per URL** (but all data already in memory)

