# Gemini File Upload Timeout Fix

## Issues Identified

1. **Short Timeout**: The `waitForOperation` function had a 60-second timeout, which is too short for large file uploads
2. **Poor Error Handling**: Limited logging made it difficult to diagnose timeout issues
3. **Operation Polling**: The polling logic didn't handle edge cases well (missing operation name, 404 errors, etc.)

## Fixes Applied

### 1. Increased Timeout (src/clients/gemini.ts)

**Before:**
```typescript
maxWaitMs = 60000  // 60 seconds
```

**After:**
```typescript
maxWaitMs = 300000  // 5 minutes (300 seconds)
```

**Why:** Large markdown files (especially from full website scrapes) can take several minutes to process and index in Gemini File Search.

### 2. Improved Operation Polling

**Changes:**
- Increased poll interval from 1 second to 2 seconds (reduces API calls)
- Added better handling for operations without a `name` property
- Improved error handling for 404s (operation not found yet - normal during initial creation)
- Added attempt counter and elapsed time logging
- Better detection of operation completion
- More detailed error messages on timeout

**Key Improvements:**
- Checks if operation is already done before polling
- Handles cases where operation name might not be immediately available
- Continues polling on transient errors (404s, network issues)
- Logs last known status on timeout for debugging

### 3. Enhanced Error Logging

**Added:**
- File size logging (KB) before upload
- Upload initiation time tracking
- Operation name and status logging
- Detailed error messages with context
- Stack trace logging (first 500 chars)
- Helpful error messages for common issues:
  - Timeout errors (with file size context)
  - Quota/limit errors
  - Permission/authorization errors

### 4. Better Upload Function Logging

**Before:**
```typescript
log.debug({ storeName, url: metadata.url }, 'Uploading to File Search store');
```

**After:**
```typescript
log.info(
  { 
    storeName, 
    url: metadata.url, 
    contentSize: `${contentSizeKB} KB`,
    title: metadata.title 
  },
  'Uploading to File Search store'
);
```

## Testing Recommendations

1. **Test with small files first** (< 100 KB) to verify the fix works
2. **Monitor logs** during upload to see:
   - Upload initiation time
   - Polling attempts and elapsed time
   - Operation completion
3. **Check for timeout errors** - should now take up to 5 minutes before timing out
4. **Review error messages** - should now provide more context about what went wrong

## Expected Behavior

### Successful Upload:
```
[INFO] Uploading to File Search store (contentSize: 45.23 KB)
[DEBUG] File created, starting upload
[DEBUG] Calling uploadToFileSearchStore
[DEBUG] Upload operation initiated (operationName: operations/abc123, done: false)
[DEBUG] Polling operation status (attempt: 1, elapsed: 2.1s)
[DEBUG] Polling operation status (attempt: 2, elapsed: 4.2s)
[INFO] Operation completed (elapsed: 6.3s, attempt: 3)
[INFO] File uploaded
```

### Timeout (if it still occurs):
```
[ERROR] Operation timed out after 300.0s
  Operation name: operations/abc123
  Last status: {...}
Failed to upload file to Gemini File Search: Operation timed out after 300.0s (File size: 1250.45 KB). The upload may take longer for large files.
```

## Next Steps

1. **Rebuild the project**: `npm run build`
2. **Test with a small website first** to verify the fix
3. **Monitor logs** during ingestion to see the improved logging
4. **If timeouts still occur**:
   - Check Gemini API status
   - Verify API key has File Search access
   - Check file sizes (very large files might need chunking)
   - Review network connectivity

## Files Modified

- `src/clients/gemini.ts`:
  - `waitForOperation()` function (lines ~323-400)
  - `uploadToFileSearchStore()` function (lines ~99-180)

