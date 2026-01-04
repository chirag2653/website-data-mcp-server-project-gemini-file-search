# Refactor Status - Two-Phase Architecture

## ✅ Completed

1. **Ingestion Service** - Fixed to use `batchScrapeStart` + `batchScrapeWait` with job ID tracking
2. **Indexing Service** - Already uses helper function `getPagesReadyForIndexing()`
3. **Sync Service** - Partially fixed:
   - ✅ New URLs use batch scrape
   - ✅ Retry logic Gemini upload removed (status='processing' only)
   - ⚠️ Retry logic still uses individual `scrapeUrl` (needs batch)
   - ⚠️ Existing URL checking uses `batchScrapeAndWait` (should use Start+Wait)
   - ⚠️ Changed pages still do Gemini upload (should write 'processing')

## 🔄 In Progress

### Sync Service Fixes Needed:

1. **Retry Logic (Line 116)**: Replace individual `scrapeUrl` with batch scrape
   - Collect all retry URLs that need re-scraping
   - Batch scrape them together
   - Write 'processing' status

2. **Existing URL Checking (Line 360)**: Use `batchScrapeStart` + `batchScrapeWait`
   - Currently uses `batchScrapeAndWait` (convenience function)
   - Should use Start+Wait to track job ID

3. **Changed Pages (Line 430-449)**: Remove Gemini upload
   - Currently uploads to Gemini directly
   - Should write 'processing' status
   - Let indexing pipeline handle Gemini upload

## 📝 To Do

1. **Create Individual URL Indexing Service**
   - New service: `indexIndividualUrl(websiteId, url)`
   - Uses `scrapeUrl` (individual scrape, not batch)
   - Only works if website exists (has pages from same domain)
   - Writes 'processing' → triggers indexing

2. **Clean up lifecycle.ts**
   - Remove or refactor `addUrl` function
   - Replace with new individual URL indexing service

3. **Schema Verification**
   - Verify all fields align
   - Check process job tracking

## Architecture Summary

**Four Services:**
1. **Ingestion**: Map → Batch Scrape → Write 'processing' → Trigger Indexing ✅
2. **Sync**: Map → Compare → Batch Scrape → Write 'processing' → Trigger Indexing 🔄
3. **Indexing**: Independent pipeline, picks up 'processing' pages ✅
4. **Individual URL Indexing**: Single URL scrape → Write 'processing' → Trigger Indexing 📝

