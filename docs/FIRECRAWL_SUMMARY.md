# FireCrawl Usage Summary

## ✅ Answers to Your Questions

### 1. **Where is `scrapeUrl` used?**
- **`src/services/lifecycle.ts`**:
  - `reindexUrl()` - Force re-scrape and re-index a specific URL
  - `addUrl()` - **Manual URL upload** (for URLs not found in FireCrawl map)

### 2. **Where is `batchScrapeAndWait` used?**
- **`src/services/ingestion.ts`** - Initial website ingestion (all discovered URLs)
- **`src/services/sync.ts`** - New URLs during sync
- **`src/services/sync.ts`** - Existing URLs during sync (checking for changes)

### 3. **Manual URL Upload?**
✅ **YES!** The `addUrl()` function exists in `src/services/lifecycle.ts`
- Allows adding URLs that weren't found in FireCrawl map
- Uses `scrapeUrl()` for single URL scraping
- Automatically scrapes, indexes, and uploads to Gemini

### 4. **What Output Are We Getting?**

#### **Minimum Required:**
- ✅ **`markdown`** - **CRITICAL** - This is what we upload to Gemini

#### **Metadata We Collect:**
- ✅ `title` - Page title
- ✅ `description` - Meta description  
- ✅ `ogImage` - Open Graph image
- ✅ `sourceURL` - Original URL
- ✅ `statusCode` - HTTP status (200, 404, 410, etc.)
- ✅ `language` - **NOW FIXED** - Page language
- ✅ All other metadata fields - **NOW PRESERVED**

### 5. **Output Consistency?**
✅ **FIXED!** Both `scrapeUrl` and `batchScrapeStatus` now return **identical structure**:
- Same metadata fields
- Same data format
- All metadata preserved (including `language` and any other fields)

## 📊 Output Format (Standardized)

Both methods now return the same structure:

```typescript
{
  success: boolean;
  data?: {
    markdown: string;           // REQUIRED - What we upload to Gemini
    html?: string;              // Optional HTML
    metadata: {
      title?: string;
      description?: string;
      ogImage?: string;
      sourceURL: string;
      statusCode: number;
      language?: string;        // NEW - Now captured
      [key: string]: unknown;   // All other metadata preserved
    };
  };
  error?: string;
}
```

## 🔧 What Was Fixed

1. ✅ **Output Format Consistency** - Both methods return identical structure
2. ✅ **Language Field** - Now captured from FireCrawl API
3. ✅ **All Metadata Preserved** - No data loss, all fields from FireCrawl are kept
4. ✅ **Type Safety** - TypeScript types updated to include `language`

## 📝 Usage Recommendations

- **Use `scrapeUrl()`** for:
  - Single URL operations
  - Manual URL additions
  - Re-indexing specific URLs
  
- **Use `batchScrapeAndWait()`** for:
  - Multiple URLs at once
  - Initial ingestion
  - Sync operations (bulk processing)

Both methods now guarantee the same output format, so your database schema and processing logic can be consistent regardless of which method is used.

