# FireCrawl Usage Analysis

## Current Usage Patterns

### 1. **`scrapeUrl()` - Single URL Scrape**
**Used in:**
- `src/services/lifecycle.ts` → `reindexUrl()` - Force re-scrape a specific URL
- `src/services/lifecycle.ts` → `addUrl()` - **Manual URL upload** (URLs not found in map)

**When to use:** Single URL operations, manual additions, re-indexing

**Output format:**
```typescript
{
  success: boolean;
  data?: {
    markdown: string;
    html?: string;
    metadata: {
      title?: string;
      description?: string;
      ogImage?: string;
      sourceURL: string;
      statusCode: number;
    };
  };
  error?: string;
}
```

### 2. **`batchScrapeAndWait()` - Batch Scrape**
**Used in:**
- `src/services/ingestion.ts` → Initial website ingestion (all discovered URLs)
- `src/services/sync.ts` → New URLs during sync
- `src/services/sync.ts` → Existing URLs during sync (checking for changes)

**When to use:** Multiple URLs at once (efficient for bulk operations)

**Output format:**
```typescript
{
  success: boolean;
  id: string;
  status: 'scraping' | 'completed' | 'failed';
  completed: number;
  total: number;
  data?: Array<{
    markdown: string;
    html?: string;
    metadata: {
      title?: string;
      description?: string;
      ogImage?: string;
      sourceURL: string;
      statusCode: number;
    };
  }>;
  error?: string;
}
```

## ⚠️ Issues Found

### 1. **Output Format Inconsistency**
- **Problem**: `batchScrapeStatus()` mapping (lines 312-322) doesn't preserve all metadata fields
- **Missing**: `language` and other metadata fields from FireCrawl API
- **Impact**: Data loss, inconsistent output between single and batch scrape

### 2. **Metadata Field Loss**
- FireCrawl API returns: `title`, `description`, `ogImage`, `sourceURL`, `statusCode`, `language`, and potentially other fields
- Current code only maps: `title`, `description`, `ogImage`, `sourceURL`, `statusCode`
- **Missing**: `language` and any other dynamic metadata fields

### 3. **Manual URL Upload**
- ✅ **EXISTS**: `addUrl()` function in `src/services/lifecycle.ts`
- ✅ **Works**: Uses `scrapeUrl()` for single URL
- ✅ **Use case**: Add URLs that weren't found in FireCrawl map

## ✅ What We're Getting from FireCrawl

### Minimum Required (for Gemini upload):
- ✅ `markdown` - **CRITICAL** - This is what we upload to Gemini

### Metadata We Collect:
- ✅ `title` - Page title
- ✅ `description` - Meta description
- ✅ `ogImage` - Open Graph image
- ✅ `sourceURL` - Original URL
- ✅ `statusCode` - HTTP status (200, 404, 410, etc.)
- ❌ `language` - **MISSING** - Not currently captured
- ❌ Other metadata - **MISSING** - Not preserved

## 🔧 Required Fixes

1. **Standardize output format** - Both `scrapeUrl` and `batchScrapeStatus` should return identical structure
2. **Preserve all metadata** - Capture `language` and preserve any other metadata fields
3. **Ensure consistency** - Same data structure regardless of scrape method

