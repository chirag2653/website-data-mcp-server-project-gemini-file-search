# Ingestion Pipeline Test Plan

## Test Objectives

1. ✅ Verify website registration (new website ID created)
2. ✅ Verify Gemini store creation (one store per website)
3. ✅ Verify only complete pages are written to DB
4. ✅ Verify incomplete/empty pages are discarded
5. ✅ Verify status progression: 'processing' → 'active'
6. ✅ Verify process job tracking (batch IDs, statistics)
7. ✅ Verify domain separation (each domain gets separate website/store)

## Test Cases

### Test 1: Single Domain Ingestion
- Input: `https://example.com`
- Expected:
  - New website created with ID
  - Store created and linked
  - Pages written with status='processing' (only complete scrapes)
  - After indexing: pages promoted to 'active'
  - No incomplete pages in DB

### Test 2: Multiple Domains (Different Websites)
- Input: `https://example.com`, `https://www.example.com`, `https://subdomain.example.com`
- Expected:
  - 3 separate websites created
  - 3 separate stores created
  - Each domain scrapes only its own pages
  - No mixing between domains

### Test 3: Verify Incomplete Pages Discarded
- Check database after ingestion
- Verify: No pages with empty markdown_content
- Verify: No pages with missing metadata
- Verify: All pages have status='processing' or 'active'

### Test 4: Verify Process Job Tracking
- Check process_jobs table
- Verify: firecrawl_batch_ids array populated
- Verify: urls_discovered, urls_updated, urls_errored counts
- Verify: created_by_ingestion_id links pages to job

## Test Script Features

- Test multiple domains sequentially
- Show detailed statistics for each domain
- Verify database state after each ingestion
- Check for incomplete pages
- Verify store creation
- Show process job details

