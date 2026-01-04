# Ingestion Pipeline Test Guide

## Quick Start

### 1. Build the Project
```bash
npm run build
```

### 2. Run the Test Script
```bash
node test-ingestion-pipeline.js
```

## Test Script Features

The test script (`test-ingestion-pipeline.js`) will:

1. **Test Multiple Domains** - Tests 3-4 domains sequentially
2. **Verify Website Registration** - Checks that each domain gets its own website ID
3. **Verify Store Creation** - Checks that each website gets its own Gemini store
4. **Verify Page Creation** - Checks that only complete pages are written to DB
5. **Verify Incomplete Pages Discarded** - Ensures no empty/incomplete pages in DB
6. **Verify Status Progression** - Checks pages go from 'processing' → 'active'
7. **Verify Process Job Tracking** - Checks batch IDs, statistics, lineage

## Customizing Test Domains

Edit `test-ingestion-pipeline.js` and modify the `TEST_DOMAINS` array:

```javascript
const TEST_DOMAINS = [
  {
    url: 'https://example.com',
    displayName: 'Example Domain',
  },
  {
    url: 'https://www.example.com',
    displayName: 'Example WWW',
  },
  {
    url: 'https://subdomain.example.com',
    displayName: 'Example Subdomain',
  },
  // Add more domains here
];
```

## What the Test Verifies

### ✅ Website Registration
- Each domain gets a unique website ID
- Domain is stored exactly as provided (no normalization)
- Website record created in Supabase

### ✅ Store Creation
- Each website gets its own Gemini File Search store
- Store ID stored in website record
- Store name follows pattern: `website-{domain}-{timestamp}`

### ✅ Page Creation (Only Complete Pages)
- Only pages with:
  - ✅ Valid `sourceURL`
  - ✅ Non-empty `markdown_content`
  - ✅ `content_hash`
  - ✅ Metadata
- Pages written with `status='processing'` (not 'active' yet)

### ✅ Incomplete Pages Discarded
- No pages with empty `markdown_content`
- No pages with missing `content_hash`
- All pages have required fields

### ✅ Status Progression
- After scraping: `status='processing'`
- After indexing: `status='active'`
- Pages with `gemini_file_id` are 'active'

### ✅ Process Job Tracking
- `process_jobs` table has ingestion job
- `firecrawl_batch_ids` array populated
- `urls_discovered`, `urls_updated`, `urls_errored` counts accurate
- `created_by_ingestion_id` links pages to job

## Expected Output

```
🧪 Ingestion Pipeline Test Suite

======================================================================
Testing 3 domain(s)
======================================================================

Test 1/3: https://example.com
======================================================================
  🚀 Starting ingestion...
  ✅ Ingestion completed in 45.23s
     Website ID: abc-123-def
     Domain: example.com
     Pages Discovered: 50
     Pages Indexed: 48
     Errors: 2

  ⏳ Waiting 5 seconds for indexing to complete...

  📊 Verifying database state for https://example.com...

  ✅ Verification Results for https://example.com:
  ============================================================

  📌 Website:
     ID: abc-123-def
     Domain: example.com
     Store ID: ✅ fileSearchStores/website-example-com-1234567890
     Store Name: website-example-com-1234567890

  📄 Pages:
     Total: 48
     Active: 48 ✅
     Processing: 0 ⏳
     Error: 0
     Pending: 0

  ✅ Completeness:
     With Markdown: 48/48
     With Hash: 48/48
     With Gemini File: 48/48

  ✅ No Issues: All pages are complete

  🔄 Process Job:
     Status: completed
     URLs Discovered: 50
     URLs Updated: 48
     URLs Errored: 2
     Batch IDs: ✅ batch-123-456

  🔍 Validation:
     ✅ hasStore: PASS
     ✅ noEmptyMarkdown: PASS
     ✅ noMissingHash: PASS
     ✅ hasBatchId: PASS
     ✅ pagesWritten: PASS
     ✅ someActive: PASS
```

## Troubleshooting

### Issue: "Website already exists"
- The domain was already ingested
- Solution: Delete the website from Supabase or use a different domain

### Issue: "No pages written"
- FireCrawl may have failed to scrape
- Check FireCrawl API key and credits
- Check network connectivity

### Issue: "Empty markdown found"
- This should NOT happen (incomplete pages are discarded)
- If it does, there's a bug in the ingestion logic

### Issue: "Missing batch ID"
- Process job should have `firecrawl_batch_ids` array
- If missing, batch scrape tracking may have failed

## Next Steps After Testing

1. **Verify in Supabase** - Check `websites`, `pages`, and `process_jobs` tables
2. **Verify in Gemini** - Check File Search stores are created
3. **Test Querying** - Use `site_ask` to query the ingested websites
4. **Test Sync** - Run sync on an existing website to test that pipeline

## Manual Verification Queries

### Check Websites
```sql
SELECT id, domain, gemini_store_id, created_at 
FROM websites 
ORDER BY created_at DESC;
```

### Check Pages
```sql
SELECT 
  status, 
  COUNT(*) as count,
  COUNT(CASE WHEN markdown_content IS NULL OR markdown_content = '' THEN 1 END) as empty_markdown
FROM pages 
WHERE website_id = 'your-website-id'
GROUP BY status;
```

### Check Process Jobs
```sql
SELECT 
  id, 
  process_type, 
  status, 
  urls_discovered, 
  urls_updated, 
  urls_errored,
  firecrawl_batch_ids
FROM process_jobs 
WHERE website_id = 'your-website-id'
ORDER BY created_at DESC;
```

