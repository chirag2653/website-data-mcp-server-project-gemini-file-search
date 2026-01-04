# Gemini HTTP Client Functions Summary

## Overview
The `gemini-http.ts` client provides direct HTTP API access to Gemini File Search, bypassing the SDK for better control and reliability. This document catalogs all available functions.

---

## 📦 File Search Store Operations

### 1. `listFileSearchStores(options?)`
**Purpose**: List all File Search stores owned by the user

**Parameters**:
- `options.pageSize?` - Number of stores per page
- `options.pageToken?` - Token for pagination

**Returns**: 
```typescript
{
  fileSearchStores: GeminiFileSearchStore[];
  nextPageToken?: string;
}
```

**API Endpoint**: `GET /v1beta/fileSearchStores`

**Use Case**: Discover all stores, check store count, paginate through stores

---

### 2. `getFileSearchStore(storeName)`
**Purpose**: Get detailed information about a specific store including document counts

**Parameters**:
- `storeName` - Store name (e.g., "fileSearchStores/my-store-123" or just "my-store-123")

**Returns**: 
```typescript
GeminiFileSearchStore | null  // null if store not found
```

**API Endpoint**: `GET /v1beta/{name=fileSearchStores/{store}}`

**Use Case**: Verify store exists, get document counts, check store status

---

### 3. `createFileSearchStore(displayName)`
**Purpose**: Create a new File Search store

**Parameters**:
- `displayName` - Human-readable name for the store

**Returns**: 
```typescript
GeminiFileSearchStore
```

**API Endpoint**: `POST /v1beta/fileSearchStores`

**Use Case**: Create store during website ingestion, initialize new stores

---

### 4. `deleteFileSearchStore(storeName)`
**Purpose**: Delete a File Search store and all its documents

**Parameters**:
- `storeName` - Store name (e.g., "fileSearchStores/my-store-123")

**Returns**: `Promise<void>`

**API Endpoint**: `DELETE /v1beta/{name=fileSearchStores/{store}}`

**Use Case**: Cleanup unused stores, remove test stores

---

## 📄 Document Operations

### 5. `listDocuments(storeName, options?)`
**Purpose**: List documents in a store with pagination

**Parameters**:
- `storeName` - Store name
- `options.pageSize?` - Documents per page (default: API default)
- `options.pageToken?` - Token for next page

**Returns**: 
```typescript
{
  documents: Array<{
    name: string;
    displayName?: string;
    mimeType?: string;
    sizeBytes?: string;
    createTime?: string;
    updateTime?: string;
    state?: string;  // 'ACTIVE', 'PENDING', 'FAILED'
  }>;
  nextPageToken?: string;
}
```

**API Endpoint**: `GET /v1beta/{parent=fileSearchStores/{store}}/documents`

**Use Case**: Browse documents, check document status, paginate through documents

---

### 6. `listAllDocuments(storeName, maxResults?)`
**Purpose**: Get all documents in a store (handles pagination automatically)

**Parameters**:
- `storeName` - Store name
- `maxResults?` - Optional limit on number of documents

**Returns**: 
```typescript
Array<{
  name: string;
  displayName?: string;
  mimeType?: string;
  sizeBytes?: string;
  createTime?: string;
  updateTime?: string;
  state?: string;
}>
```

**Use Case**: Get complete document list, verify all documents uploaded, sync document list

---

### 7. `getDocument(documentName)`
**Purpose**: Get details of a specific document

**Parameters**:
- `documentName` - Full document name (e.g., "fileSearchStores/{store}/documents/{doc}")

**Returns**: 
```typescript
{
  name: string;
  displayName?: string;
  mimeType?: string;
  sizeBytes?: string;
  createTime?: string;
  updateTime?: string;
  state?: string;
}
```

**API Endpoint**: `GET /v1beta/{name=fileSearchStores/{store}/documents/{document}}`

**Use Case**: Verify document exists, check document state, get document metadata

---

### 8. `deleteDocument(documentName)`
**Purpose**: Delete a document from a store

**Parameters**:
- `documentName` - Full document name or just document ID

**Returns**: `Promise<void>`

**API Endpoint**: `DELETE /v1beta/{name=fileSearchStores/{store}/documents/{document}}`

**Use Case**: Remove outdated documents, cleanup failed uploads, sync deletions

---

## ⬆️ File Upload Operations

### 9. `uploadToFileSearchStore(storeName, content, metadata)`
**Purpose**: Upload markdown content to a File Search store

**Parameters**:
- `storeName` - Store name
- `content` - Markdown content string
- `metadata` - File metadata:
  ```typescript
  {
    url: string;
    title: string;
    path?: string;
    lastUpdated?: string;
  }
  ```

**Returns**: 
```typescript
FileUploadResult {
  name: string;              // Document resource name
  displayName?: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  state: string;            // 'ACTIVE', 'PENDING', 'FAILED'
}
```

**API Endpoint**: `POST /upload/v1beta/{fileSearchStoreName}:uploadToFileSearchStore`

**Features**:
- Handles multipart/form-data upload
- Automatically polls operation if needed
- Returns immediately if operation completes quickly
- Handles both synchronous and asynchronous uploads

**Use Case**: Upload individual pages, single file uploads, manual uploads

---

### 10. `uploadFilesInBatches(storeName, items, options?)`
**Purpose**: Upload multiple files in parallel batches with rate limiting

**Parameters**:
- `storeName` - Store name
- `items` - Array of items to upload:
  ```typescript
  Array<{
    id: string;              // Page ID or unique identifier
    content: string;         // Markdown content
    metadata: FileUploadMetadata;
  }>
  ```
- `options.batchSize?` - Concurrent uploads per batch (default: 5)
- `options.onProgress?` - Progress callback: `(completed, total, result) => void`

**Returns**: 
```typescript
Array<BatchUploadResult> {
  id: string;
  success: boolean;
  result?: FileUploadResult;
  error?: string;
}
```

**Features**:
- Parallel processing (5 concurrent uploads by default)
- Automatic rate limit handling (429 errors)
- Retry logic for rate-limited requests
- Progress tracking via callback
- Brief pause between batches to avoid rate limits

**Configuration** (via `BATCH_CONFIG`):
- `BATCH_SIZE: 5` - Concurrent uploads per batch
- `POLL_BATCH_SIZE: 5` - Concurrent operation polls
- `POLL_INTERVAL_MS: 2000` - 2 seconds between polls
- `MAX_WAIT_TIME_MS: 300000` - 5 minutes max wait per file
- `RATE_LIMIT_BACKOFF_MS: 2000` - Base backoff on 429
- `MAX_UPLOAD_RETRIES: 3` - Max retries for upload errors

**Use Case**: Bulk indexing, batch uploads during ingestion/sync, processing multiple pages

---

## 🔄 Operation Polling

### 11. `getOperation(operationName)`
**Purpose**: Get status of an async operation

**Parameters**:
- `operationName` - Full operation name (e.g., "fileSearchStores/{store}/upload/operations/{op}")

**Returns**: 
```typescript
{
  name: string;
  done: boolean;
  response?: any;    // Document info when done=true
  error?: any;       // Error info if operation failed
}
```

**API Endpoint**: `GET /v1beta/{name=fileSearchStores/{store}/upload/operations/{operation}}`

**Use Case**: Check operation status, debug failed operations, monitor upload progress

---

### 12. `pollOperation(operationName, options?)`
**Purpose**: Poll an operation until it completes

**Parameters**:
- `operationName` - Full operation name
- `options.pollIntervalMs?` - Poll interval in milliseconds (default: 2000)
- `options.maxWaitMs?` - Maximum wait time (default: 300000 = 5 minutes)

**Returns**: 
```typescript
{
  name: string;
  done: boolean;
  response?: any;
  error?: any;
}
```

**Features**:
- Automatic polling until completion
- Configurable poll interval and timeout
- Throws error if operation fails or times out

**Use Case**: Wait for upload completion, ensure operation finishes before proceeding

---

## 🔧 Configuration & Constants

### `BATCH_CONFIG`
Exported configuration object for batch operations:
```typescript
{
  BATCH_SIZE: 5,
  POLL_BATCH_SIZE: 5,
  POLL_INTERVAL_MS: 2000,
  MAX_WAIT_TIME_MS: 300000,
  RATE_LIMIT_BACKOFF_MS: 2000,
  MAX_UPLOAD_RETRIES: 3,
}
```

---

## 📝 Type Definitions

### `FileUploadMetadata`
```typescript
{
  url: string;
  title: string;
  path?: string;
  lastUpdated?: string;
}
```

### `FileUploadResult`
```typescript
{
  name: string;
  displayName?: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  state: string;  // 'ACTIVE', 'PENDING', 'FAILED'
}
```

### `BatchUploadItem`
```typescript
{
  id: string;
  content: string;
  metadata: FileUploadMetadata;
}
```

### `BatchUploadResult`
```typescript
{
  id: string;
  success: boolean;
  result?: FileUploadResult;
  error?: string;
}
```

---

## 🎯 Usage Examples

### Example 1: List all stores
```typescript
import * as geminiHttp from './clients/gemini-http.js';

const result = await geminiHttp.listFileSearchStores({ pageSize: 10 });
console.log(`Found ${result.fileSearchStores.length} stores`);
```

### Example 2: Upload a single file
```typescript
const result = await geminiHttp.uploadToFileSearchStore(
  'fileSearchStores/my-store-123',
  '# Hello World\n\nThis is markdown content.',
  {
    url: 'https://example.com/page',
    title: 'Example Page',
    path: '/page',
  }
);
console.log(`Uploaded: ${result.name}, State: ${result.state}`);
```

### Example 3: Batch upload
```typescript
const items = [
  { id: 'page1', content: '# Page 1', metadata: { url: '...', title: '...' } },
  { id: 'page2', content: '# Page 2', metadata: { url: '...', title: '...' } },
];

const results = await geminiHttp.uploadFilesInBatches(
  'fileSearchStores/my-store-123',
  items,
  {
    onProgress: (completed, total) => {
      console.log(`Progress: ${completed}/${total}`);
    }
  }
);

const successful = results.filter(r => r.success).length;
console.log(`Uploaded ${successful}/${items.length} files`);
```

### Example 4: List all documents in a store
```typescript
const documents = await geminiHttp.listAllDocuments('fileSearchStores/my-store-123');
console.log(`Store has ${documents.length} documents`);
documents.forEach(doc => {
  console.log(`- ${doc.displayName} (${doc.state})`);
});
```

---

## ✅ Current Usage in Codebase

- **`indexing.ts`**: Uses `createFileSearchStore()`, `uploadFilesInBatches()` for bulk indexing
- **`ingestion.ts`**: Uses SDK version for store creation (could migrate to HTTP)
- **Test scripts**: Various test files use HTTP client for verification

---

## 🔍 Testing

Run the test script to verify functions work:
```bash
node test-gemini-http-client.js
```

This will:
1. List all File Search stores
2. Get details of the first store
3. Verify the client is working correctly

