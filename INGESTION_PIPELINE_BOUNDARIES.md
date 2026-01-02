# Ingestion Pipeline Boundaries - Clear Definition

## ✅ Ingestion Pipeline Scope

**Ingestion Pipeline DOES:**
1. Map website (discover URLs)
2. Batch scrape URLs
3. Write complete pages to DB with `status='processing'`
4. Update ingestion job to `status='completed'`
5. **Trigger indexing pipeline** (final step)

**Ingestion Pipeline DOES NOT:**
- Upload pages to Gemini (that's indexing pipeline)
- Promote pages to `status='active'` (that's indexing pipeline)
- Wait for indexing to complete (indexing is separate/async)

## 🎯 Where Ingestion Ends

**Ingestion ends at Step 9: After triggering indexing pipeline**

```typescript
// Step 7: Update ingestion job (status='completed')
await supabase.updateProcessJob(ingestionJob.id, {
  status: 'completed',
  urls_updated: pagesWritten, // Pages written with status='processing'
});

// Step 8: Update website
await supabase.updateWebsite(website.id, {
  last_full_crawl: now,
});

// Step 9: Trigger indexing pipeline (FINAL STEP - ingestion ends here)
await indexingService.indexWebsite(website.id, {
  ingestionJobId: ingestionJob.id,
});

// Return result (ingestion complete)
return {
  websiteId: website.id,
  pagesDiscovered: discoveredUrls.length,
  pagesIndexed: pagesWritten, // Note: This is pages WRITTEN, not pages uploaded to Gemini
};
```

## 📊 What Ingestion Test Should Verify

### ✅ Ingestion Success Criteria:
1. **Website Created**: New website record with store ID
2. **URLs Discovered**: Count of URLs found via map
3. **Pages Written**: Only complete pages written to DB
4. **Status Correct**: All pages have `status='processing'` (NOT 'active')
5. **Completeness**: All pages have:
   - ✅ Valid URL
   - ✅ Non-empty markdown_content
   - ✅ content_hash
   - ✅ Metadata
6. **No Incomplete Pages**: Zero pages with empty markdown or missing data
7. **Process Job**: Ingestion job marked 'completed' with correct stats
8. **Indexing Triggered**: Indexing pipeline was called (but we don't wait for it)

### ❌ NOT Part of Ingestion Test:
- Pages with `status='active'` (that's indexing pipeline)
- Gemini file IDs on pages (that's indexing pipeline)
- Indexing completion (that's separate pipeline)

## 🔄 Two Separate Pipelines

### Ingestion Pipeline (What We're Testing)
```
Map → Scrape → Write 'processing' → Trigger Indexing → END
```

### Indexing Pipeline (Separate, Triggered by Ingestion)
```
Pick 'processing' pages → Upload to Gemini → Set 'active' → END
```

## 📝 Test Expectations

**After ingestion completes:**
- ✅ Pages in DB with `status='processing'`
- ✅ All pages have complete data (markdown, hash, metadata)
- ✅ No incomplete pages in DB
- ✅ Indexing pipeline was triggered (can verify by checking if indexing job exists)

**After indexing completes (separate):**
- ✅ Pages promoted to `status='active'`
- ✅ Pages have `gemini_file_id`
- ✅ Pages uploaded to Gemini

## 🎯 Clear Test Boundaries

**Ingestion Test = Test Steps 1-9 (up to triggering indexing)**
**Indexing Test = Separate test (not part of ingestion test)**

