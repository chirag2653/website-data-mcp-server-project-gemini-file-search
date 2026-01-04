# Indexing Service Refactor Plan

## Overview
Refactor the indexing service to use direct HTTP API endpoints instead of the SDK, with proper async operation handling, parallel processing, and rate limit management.

## Current State Analysis

### Current Implementation
- Uses `@google/genai` SDK (`genai.fileSearchStores.uploadToFileSearchStore()`)
- Processes files sequentially (one at a time)
- Waits for each upload to complete before starting the next
- Uses SDK's internal operation polling mechanism

### Issues with Current Approach
1. **SDK Dependency**: Relies on SDK which may have bugs or limitations
2. **Sequential Processing**: Slow for large batches
3. **No Rate Limit Control**: Could hit API rate limits (15 RPM on free tier)
4. **Operation Tracking**: Limited visibility into individual operation status

## API Reference

### Upload Endpoint
- **Method**: `POST`
- **URL**: `https://generativelanguage.googleapis.com/upload/v1beta/{fileSearchStoreName}:uploadToFileSearchStore`
- **Format**: `fileSearchStoreName = fileSearchStores/{store-id}`
- **Request**: Multipart/form-data with file content
- **Response**: Operation object with:
  - `name`: Operation resource name (format: `fileSearchStores/{store}/upload/operations/{operation}`)
  - `done`: Boolean (false = in progress, true = complete)
  - `response`: Document resource when done=true
  - `error`: Error object if operation failed

### Operation Polling Endpoint
- **Method**: `GET`
- **URL**: `https://generativelanguage.googleapis.com/v1beta/{name}`
- **Format**: `name = fileSearchStores/{store}/upload/operations/{operation}`
- **Response**: Operation object with current status

### Document States
- `STATE_PENDING`: Document is being processed (embedding and vector storage)
- `STATE_ACTIVE`: Document is processed and available for querying
- `STATE_FAILED`: Some chunks failed processing

## Implementation Plan

### Phase 1: Create HTTP-Based Upload Function

**File**: `src/clients/gemini-http.ts` (new file)

**Function**: `uploadToFileSearchStoreHTTP()`
- Accepts: `storeName`, `content` (markdown string), `metadata`
- Creates multipart/form-data request
- POSTs to upload endpoint
- Returns: Operation object with `name`, `done`, `response`, `error`

**Technical Decisions**:
- Use `FormData` API for multipart uploads
- Set `Content-Type: multipart/form-data` with boundary
- Include metadata in form fields: `displayName`, `customMetadata[]`, `mimeType`
- Handle both upload URI and metadata URI endpoints

### Phase 2: Implement Operation Polling

**Function**: `pollUploadOperation()`
- Accepts: `operationName` (full resource name)
- Polls operation status endpoint
- Returns: Completed operation with document info

**Technical Decisions**:
- **Poll Interval**: 2 seconds (balance between responsiveness and API load)
- **Max Wait Time**: 5 minutes per file (sufficient for large files)
- **Max Poll Attempts**: 150 (5 min / 2 sec)
- **Exponential Backoff**: On 429 errors, wait 2^attempt seconds (max 60s)
- **Polling Strategy**: 
  - Check `done` field
  - If `done=true`, extract document from `response`
  - If `error` present, throw error
  - If timeout, throw timeout error

### Phase 3: Parallel Processing with Concurrency Control

**Function**: `uploadFilesInBatches()`
- Accepts: Array of files to upload, batch size, concurrency limit
- Processes files in batches
- Tracks operations per file
- Polls operations in parallel

**Technical Decisions**:
- **Batch Size**: 5 concurrent uploads (respects ~15 RPM limit with buffer)
- **Concurrency Control**: Use `Promise.allSettled()` for batch processing
- **Rate Limit Handling**: 
  - If 429 received, back off entire batch
  - Wait before retrying failed requests
  - Track requests per minute to avoid hitting limits
- **Operation Tracking**: 
  - Store operation name per file
  - Poll operations in parallel (same batch size)
  - Track which files are pending vs completed

### Phase 4: Update Indexing Service

**File**: `src/services/indexing.ts`

**Changes**:
1. Replace `gemini.uploadToFileSearchStore()` with `geminiHTTP.uploadToFileSearchStoreHTTP()`
2. Implement batch processing:
   - Get all pages ready for indexing
   - Process in batches of 5
   - Track operations for each page
3. Poll operations:
   - After batch upload completes, poll all operations
   - Wait for operations to complete
   - Extract document info from completed operations
4. Update database:
   - Only mark as 'active' when operation completes successfully
   - Store `gemini_file_id` from operation response
   - Store `gemini_document_state` (ACTIVE, PENDING, FAILED)
   - On failure, keep status='processing' and set `error_message`

**Workflow**:
```
1. Get pages with status='processing' and markdown_content
2. For each batch of 5 pages:
   a. Upload all 5 files in parallel → get 5 operations
   b. Poll all 5 operations in parallel until done
   c. For each completed operation:
      - If success: Update page to 'active' with document info
      - If failure: Keep 'processing', set error_message
3. Continue with next batch
4. Update indexing job with results
```

### Phase 5: Error Handling & Retry Logic

**Error Scenarios**:
1. **Rate Limit (429)**: Back off and retry after delay
2. **Network Error**: Retry with exponential backoff (max 3 retries)
3. **Operation Timeout**: Mark as failed, keep 'processing' status
4. **Operation Failed**: Extract error from operation, log and mark as failed
5. **Invalid Response**: Log error, keep 'processing' for retry

**Retry Strategy**:
- Failed uploads remain with status='processing'
- Next indexing run will pick them up automatically
- No infinite retry loops (rely on manual intervention if needed)

## Technical Configuration

### Constants
```typescript
const CONFIG = {
  // Concurrency
  BATCH_SIZE: 5,                    // Concurrent uploads per batch
  POLL_BATCH_SIZE: 5,                // Concurrent operation polls
  
  // Timing
  POLL_INTERVAL_MS: 2000,            // 2 seconds between polls
  MAX_WAIT_TIME_MS: 300000,          // 5 minutes max wait per file
  MAX_POLL_ATTEMPTS: 150,            // 5 min / 2 sec
  
  // Rate Limiting
  RATE_LIMIT_RPM: 15,                // API rate limit (requests per minute)
  RATE_LIMIT_BACKOFF_BASE_MS: 2000, // Base backoff on 429 (2 seconds)
  RATE_LIMIT_BACKOFF_MAX_MS: 60000,  // Max backoff (60 seconds)
  
  // Retries
  MAX_UPLOAD_RETRIES: 3,             // Max retries for upload errors
  RETRY_DELAY_BASE_MS: 1000,         // Base delay for retries (1 second)
};
```

### API Base URLs
```typescript
const API_BASE = 'https://generativelanguage.googleapis.com';
const UPLOAD_ENDPOINT = `${API_BASE}/upload/v1beta`;
const API_ENDPOINT = `${API_BASE}/v1beta`;
```

## Implementation Steps

1. ✅ Create `src/clients/gemini-http.ts` with HTTP-based functions
2. ✅ Implement `uploadToFileSearchStoreHTTP()` function
3. ✅ Implement `pollUploadOperation()` function
4. ✅ Implement `uploadFilesInBatches()` helper
5. ✅ Update `src/services/indexing.ts` to use HTTP functions
6. ✅ Add proper error handling and logging
7. ✅ Test with small batch (1-2 files)
8. ✅ Test with larger batch (10+ files)
9. ✅ Verify rate limit handling
10. ✅ Verify retry logic for failed uploads

## Testing Strategy

### Unit Tests
- Test upload function with mock HTTP responses
- Test operation polling with various states
- Test batch processing logic
- Test error handling scenarios

### Integration Tests
- Upload single file and verify operation completes
- Upload batch of 5 files and verify all complete
- Test rate limit handling (mock 429 responses)
- Test timeout scenarios
- Verify database updates (status, document info)

### Edge Cases
- Empty markdown content
- Very large files (>1MB)
- Network failures during upload
- Network failures during polling
- Operation that never completes (timeout)
- Operation that fails after starting

## Migration Notes

### Backward Compatibility
- Keep existing SDK functions in `src/clients/gemini.ts` for now
- Only indexing service uses new HTTP functions
- Other services (lifecycle, individual-url) can continue using SDK
- Can migrate them later if needed

### Database Schema
- No schema changes needed
- Existing fields used:
  - `status`: 'processing' → 'active'
  - `gemini_file_id`: Document resource name
  - `gemini_document_state`: ACTIVE, PENDING, FAILED
  - `error_message`: Error details on failure

## Success Criteria

1. ✅ Indexing service uses HTTP endpoints instead of SDK
2. ✅ Files upload in parallel batches (5 concurrent)
3. ✅ Operations polled individually until complete
4. ✅ Rate limits respected (no 429 errors in normal operation)
5. ✅ Failed uploads remain 'processing' for retry
6. ✅ Successful uploads marked 'active' with document info
7. ✅ No breaking changes to ingestion or sync services
8. ✅ Proper error logging and tracking

## Questions for Review

### Workflow Questions
1. **Status Updates**: Should we update `last_updated_by_process_id` when marking pages as active?
2. **Job Tracking**: Should indexing job track individual operation IDs for debugging?
3. **Retry Strategy**: Should we add a retry count field to prevent infinite retries?
4. **Scheduling**: When running on schedule, should we process all 'processing' pages or limit to a batch?

### Technical Decisions Made
- Batch size: 5 (configurable)
- Poll interval: 2 seconds
- Max wait: 5 minutes per file
- Rate limit handling: Exponential backoff on 429
- Retry strategy: Keep 'processing' status, retry on next run

## Next Steps

1. Review this plan
2. Confirm workflow decisions
3. Implement Phase 1-3 (HTTP functions)
4. Update indexing service (Phase 4)
5. Test and verify
6. Deploy

