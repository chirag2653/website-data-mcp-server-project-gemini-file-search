# Gemini File Search API Analysis

## Documentation Review
Based on: https://ai.google.dev/api/file-search/file-search-stores

## Key Findings

### 1. **Upload Operation Structure** ✅

According to the docs, `uploadToFileSearchStore` returns an **Operation** object with:
- `name`: Operation resource name (format: `fileSearchStores/{store}/upload/operations/{operation}`)
- `done`: Boolean indicating if operation is complete
- `response`: Contains the document resource when `done=true`
- `error`: Contains error if operation failed

### 2. **Operation Polling Endpoints** ⚠️

The documentation shows **TWO different endpoints** for polling:

1. **`fileSearchStores.upload.operations.get`** 
   - For upload operations
   - Format: `fileSearchStores/{store}/upload/operations/{operation}`
   - Endpoint: `GET /v1beta/{name=fileSearchStores/*/upload/operations/*}`

2. **`fileSearchStores.operations.get`**
   - For general operations  
   - Format: `fileSearchStores/{store}/operations/{operation}`
   - Endpoint: `GET /v1beta/{name=fileSearchStores/*/operations/*}`

### 3. **Current Implementation** ✅

Our code:
- ✅ Correctly calls `genai.fileSearchStores.uploadToFileSearchStore()` 
- ✅ Gets operation object with `name`, `done`, `response`
- ✅ Waits for operation to complete
- ⚠️ Uses `genai.operations.get()` for polling (SDK may abstract the endpoint choice)

### 4. **The Error** 🔍

**Error:** `Cannot read properties of undefined (reading 'name')`

**Possible Causes:**
1. SDK internal bug when accessing operation properties
2. Operation name format mismatch
3. SDK trying to access undefined property internally

**Our Fix:**
- Added validation before calling `genai.operations.get()`
- Added retry limit (fails after 20 attempts)
- Added fallback: if operation has `response`, assume complete
- Better error logging to debug SDK issues

## Architecture Confirmation

### **Indexing is a Separate Process** ✅

Yes, indexing is a **separate step** and **separate process**:

1. **Ingestion Pipeline** (scraping):
   - Discovers URLs via FireCrawl `/map`
   - Batch scrapes URLs
   - Writes complete scrapes to DB with `status='processing'`
   - **Triggers indexing** (but doesn't wait for it)

2. **Indexing Pipeline** (Gemini upload):
   - **Independent process** that can run separately
   - Picks up pages with `status='processing'`
   - Uploads markdown to Gemini File Search
   - Updates status to `'active'` after successful upload
   - Can be retried independently if it fails

3. **Process Separation:**
   - Ingestion writes to DB → triggers indexing → returns
   - Indexing runs asynchronously (can be called separately)
   - Indexing errors don't fail ingestion (try-catch in place)

## What We're Doing Right ✅

1. ✅ **Two-phase architecture**: Scrape first, index second
2. ✅ **Status management**: `processing` → `active`
3. ✅ **Retry capability**: Indexing can be retried without re-scraping
4. ✅ **Error isolation**: Indexing errors don't fail ingestion
5. ✅ **Operation polling**: Waiting for async Gemini uploads

## Potential Issues ⚠️

1. **SDK Operation Polling**: The error suggests the SDK might have an internal issue
2. **Operation Name Format**: Need to verify the SDK handles upload operation names correctly
3. **Response Extraction**: Need to verify how to extract document name from operation response

## Recommendations

1. **Monitor the operation name format** - Log it to see if it matches expected format
2. **Check if operation completes without polling** - Some operations might be synchronous
3. **Verify document name extraction** - The `response` field should contain the document resource

## Next Steps

1. Run test with enhanced logging to see actual operation name format
2. Check if SDK has alternative methods for upload operation polling
3. Verify document name extraction from operation response

