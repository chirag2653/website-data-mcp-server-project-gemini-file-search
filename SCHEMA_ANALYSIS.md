# Supabase Schema Analysis & Migration Guide

## ✅ Complete Schema Review

### What We're Collecting vs What We Need

#### **FireCrawl Map Output** ✅
- **Returns**: `links: string[]` (just URLs)
- **We Store**: `url`, `path` (extracted), `website_id`
- **Status**: ✅ Complete - No additional fields needed

#### **FireCrawl Scrape/Batch Scrape Output** ✅
- **Returns**:
  - `markdown: string` → Hashed and stored in `content_hash`
  - `metadata.title` → Stored in `title` column AND `metadata.title` (JSONB)
  - `metadata.description` → Stored in `metadata.description` (JSONB)
  - `metadata.ogImage` → Stored in `metadata.og_image` (JSONB)
  - `metadata.sourceURL` → Used as `url`
  - `metadata.statusCode` → **NEW**: Now stored in `http_status_code` column
  - `metadata.language` → Stored in `metadata.language` (JSONB)
  - Other metadata → Stored in `metadata` JSONB
- **Status**: ✅ Complete with new `http_status_code` field

#### **Gemini File Search Upload Response** ✅
- **Returns**:
  - `name` → Stored in `gemini_file_id` (full document name for deletion)
  - `displayName` → Stored in `gemini_file_name`
  - `mimeType` → **NEW**: Can be stored (always 'text/markdown' but useful for future)
  - `sizeBytes` → **NEW**: Now stored in `gemini_document_size_bytes`
  - `createTime` → **NEW**: Now stored in `gemini_document_created_at`
  - `state` → **NEW**: Now stored in `gemini_document_state` enum
- **Status**: ✅ Complete with new tracking fields

#### **Gemini File Search Store** ✅
- **Returns**:
  - `name` → Stored in `gemini_store_id`
  - `displayName` → Stored in `gemini_store_name`
  - `createTime` / `updateTime` → Not stored (not critical for operations)
- **Status**: ✅ Complete - Store timestamps not needed for operations

## 📋 New Fields Added to Schema

### Pages Table - New Columns:

1. **`http_status_code INTEGER`**
   - **Purpose**: Track last HTTP status code from FireCrawl (200, 404, 410, etc.)
   - **Use Case**: Better debugging and filtering of error pages
   - **Indexed**: Yes (`idx_pages_http_status`)

2. **`gemini_document_state gemini_document_state`**
   - **Purpose**: Track document processing state (PROCESSING/ACTIVE/FAILED)
   - **Use Case**: Monitor document upload status, debug failed uploads
   - **Enum**: `PROCESSING`, `ACTIVE`, `FAILED`

3. **`gemini_document_size_bytes BIGINT`**
   - **Purpose**: Track document size in bytes
   - **Use Case**: Monitoring, quota tracking, debugging

4. **`gemini_document_created_at TIMESTAMPTZ`**
   - **Purpose**: Track when document was created in Gemini
   - **Use Case**: Audit trail, debugging

### New Indexes:

1. **`idx_pages_missing_count`** - For efficient threshold-based deletion queries
2. **`idx_pages_http_status`** - For filtering by status code
3. **`idx_pages_website_url`** - Composite index for common lookups
4. **`idx_sync_logs_started_at`** - For history queries (DESC order)
5. **`idx_websites_gemini_store`** - For store lookups

## 🔄 Code Updates Needed

### Required Updates (to use new fields):

1. **Update `src/types/index.ts`**:
   - Add new fields to `Page` interface
   - Add `gemini_document_state` enum type

2. **Update `src/services/sync.ts`**:
   - Store `http_status_code` when scraping
   - Store `gemini_document_state`, `gemini_document_size_bytes`, `gemini_document_created_at` when uploading

3. **Update `src/services/ingestion.ts`**:
   - Store all new Gemini fields when uploading

4. **Update `src/services/lifecycle.ts`**:
   - Store all new Gemini fields when reindexing

### Optional Updates (nice to have):

- Add queries to filter by `http_status_code`
- Add monitoring for `gemini_document_state = 'FAILED'`
- Add size tracking/quota monitoring

## ✅ Verification Checklist

- [x] FireCrawl map output → All data captured
- [x] FireCrawl scrape output → All metadata captured (including statusCode)
- [x] FireCrawl batch scrape → Same as scrape
- [x] Gemini upload response → All fields captured (name, displayName, state, size, createTime)
- [x] Gemini document deletion → `gemini_file_id` format correct for `fileSearchStores.documents.delete()`
- [x] Threshold-based deletion → `missing_count` field present
- [x] Content change detection → `content_hash` field present
- [x] Error tracking → `error_message` field present
- [x] Metadata flexibility → `metadata` JSONB field for any additional data
- [x] Performance indexes → All critical queries indexed

## 🚀 Migration Instructions

1. **Run the migration** in Supabase SQL Editor:
   ```sql
   -- Copy and paste contents of supabase/migrations/001_initial_schema.sql
   ```

2. **Update TypeScript types** (if using new fields):
   - Add new fields to `Page` interface in `src/types/index.ts`

3. **Update service code** (optional - for full feature usage):
   - Store `http_status_code` from FireCrawl responses
   - Store Gemini document fields from upload responses

4. **Verify**:
   - Check that all tables were created
   - Check that indexes were created
   - Test a basic insert/query

## 📝 Notes

- **Backward Compatible**: New fields are nullable, so existing code will continue to work
- **Gradual Migration**: You can update code to use new fields incrementally
- **No Breaking Changes**: All existing fields remain unchanged

