# Ingestion Pipeline Test Scope - Clear Definition

## ✅ What Ingestion Pipeline Does

**Ingestion Pipeline (Steps 1-9):**
1. Check if website exists (if yes, switch to sync)
2. Create Gemini File Search store
3. Create website record in Supabase
4. Create ingestion process job
5. Map website (discover URLs via FireCrawl)
6. Filter URLs by exact domain
7. Start batch scrape job
8. Wait for batch scrape completion (with progress logging)
9. Process results:
   - Validate completeness (URL + non-empty markdown)
   - Write complete pages to DB with `status='processing'`
   - Discard incomplete pages (never write to DB)
10. Update ingestion job: `status='completed'`
11. Update website: `last_full_crawl`
12. **Trigger indexing pipeline** ← **INGESTION ENDS HERE**

## 🎯 Ingestion Pipeline Ends

**Ingestion ends after Step 12: Triggering indexing pipeline**

```typescript
// Step 9: Trigger indexing pipeline (FINAL STEP)
await indexingService.indexWebsite(website.id, {
  ingestionJobId: ingestionJob.id,
});

// Return result (ingestion complete)
return {
  websiteId: website.id,
  pagesDiscovered: discoveredUrls.length,
  pagesIndexed: pagesWritten, // Pages WRITTEN (not uploaded to Gemini)
};
```

**Key Point:** Ingestion triggers indexing but does NOT wait for it to complete. Indexing is a separate pipeline.

## 📊 What Ingestion Test Verifies

### ✅ Success Criteria for Ingestion:

1. **Website Created**
   - ✅ New website record exists
   - ✅ Gemini store created and linked
   - ✅ Store ID stored in website record

2. **URLs Discovered**
   - ✅ URLs found via FireCrawl map
   - ✅ URLs filtered by exact domain
   - ✅ Count matches process job `urls_discovered`

3. **Pages Written to DB**
   - ✅ Only complete pages written (valid URL + non-empty markdown)
   - ✅ All pages have `status='processing'` (NOT 'active')
   - ✅ All pages have `content_hash`
   - ✅ All pages have `markdown_content` (non-empty)
   - ✅ All pages have metadata

4. **No Incomplete Pages**
   - ✅ Zero pages with empty markdown
   - ✅ Zero pages missing content hash
   - ✅ All pages have required fields

5. **Process Job Tracking**
   - ✅ Ingestion job status = 'completed'
   - ✅ `urls_discovered` = URLs found
   - ✅ `urls_updated` = Pages written to DB
   - ✅ `firecrawl_batch_ids` array populated

6. **Indexing Triggered**
   - ✅ Indexing pipeline was called (can verify by checking for indexing job)

### ❌ NOT Part of Ingestion Test:

- Pages with `status='active'` (that's indexing pipeline)
- Pages with `gemini_file_id` (that's indexing pipeline)
- Indexing completion (that's separate pipeline)
- Waiting for indexing to finish (not part of ingestion)

## 🔄 Two Separate Pipelines

### Ingestion Pipeline (What We're Testing)
```
Map → Scrape → Write 'processing' → Trigger Indexing → END
Duration: ~5-10 minutes (batch scrape)
Output: Pages with status='processing' in DB
```

### Indexing Pipeline (Separate, Triggered by Ingestion)
```
Pick 'processing' pages → Upload to Gemini → Set 'active' → END
Duration: ~1-5 minutes (depends on page count)
Output: Pages with status='active' and gemini_file_id
```

## 📝 Test Expectations

**After ingestion completes:**
- ✅ Pages in DB with `status='processing'`
- ✅ All pages have complete data (markdown, hash, metadata)
- ✅ No incomplete pages in DB
- ✅ Ingestion job status = 'completed'
- ✅ Indexing pipeline was triggered (separate process)

**NOT Expected:**
- ❌ Pages with `status='active'` (indexing hasn't finished yet)
- ❌ Pages with `gemini_file_id` (indexing hasn't finished yet)

## 🎯 Clear Test Boundaries

**Ingestion Test = Test Steps 1-12 (up to and including triggering indexing)**
**Indexing Test = Separate test (not part of ingestion test)**

