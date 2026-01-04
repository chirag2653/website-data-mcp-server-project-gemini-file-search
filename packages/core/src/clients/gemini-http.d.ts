/**
 * Gemini File Search HTTP API client
 * Direct API calls for store management, document operations, and testing
 *
 * This client uses the REST API directly instead of the SDK for:
 * - Better control and visibility
 * - Avoiding SDK limitations/bugs
 * - Following API docs exactly
 *
 * Keep gemini.ts (SDK-based) for search operations which work well.
 *
 * API Reference:
 * - https://ai.google.dev/api/file-search/file-search-stores
 * - https://ai.google.dev/api/file-search/documents
 */
import type { GeminiFileSearchStore } from '../types/index.js';
/**
 * List all File Search stores owned by the user
 *
 * GET /v1beta/fileSearchStores
 *
 * @param options - Pagination options
 */
export declare function listFileSearchStores(options?: {
    pageSize?: number;
    pageToken?: string;
}): Promise<{
    fileSearchStores: GeminiFileSearchStore[];
    nextPageToken?: string;
}>;
/**
 * Get a File Search store by name with full details including document counts
 *
 * GET /v1beta/{name=fileSearchStores/*}
 */
export declare function getFileSearchStore(storeName: string): Promise<GeminiFileSearchStore | null>;
/**
 * List documents in a File Search store
 *
 * GET /v1beta/{parent=fileSearchStores/{store}}/documents
 *
 * @param storeName - Store name (e.g., "fileSearchStores/my-store-123")
 * @param options - Pagination options
 */
export declare function listDocuments(storeName: string, options?: {
    pageSize?: number;
    pageToken?: string;
}): Promise<{
    documents: Array<{
        name: string;
        displayName?: string;
        mimeType?: string;
        sizeBytes?: string;
        createTime?: string;
        updateTime?: string;
        state?: string;
    }>;
    nextPageToken?: string;
}>;
/**
 * Get all documents in a store (handles pagination automatically)
 */
export declare function listAllDocuments(storeName: string, maxResults?: number): Promise<Array<{
    name: string;
    displayName?: string;
    mimeType?: string;
    sizeBytes?: string;
    createTime?: string;
    updateTime?: string;
    state?: string;
}>>;
/**
 * Get a single document by name
 *
 * GET /v1beta/{name=fileSearchStores/{store}/documents/{document}}
 */
export declare function getDocument(documentName: string): Promise<{
    name: string;
    displayName?: string;
    mimeType?: string;
    sizeBytes?: string;
    createTime?: string;
    updateTime?: string;
    state?: string;
}>;
/**
 * Delete a document from File Search store
 *
 * DELETE /v1beta/{name=fileSearchStores/{store}/documents/{document}}
 */
export declare function deleteDocument(documentName: string): Promise<void>;
/**
 * Get operation status
 *
 * GET /v1beta/{name=fileSearchStores/{store}/upload/operations/{operation}}
 * or
 * GET /v1beta/{name=fileSearchStores/{store}/operations/{operation}}
 */
export declare function getOperation(operationName: string): Promise<{
    name: string;
    done: boolean;
    response?: any;
    error?: any;
}>;
/**
 * Poll an operation until it completes
 *
 * @param operationName - Full operation name
 * @param options - Polling options
 */
export declare function pollOperation(operationName: string, options?: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
}): Promise<{
    name: string;
    done: boolean;
    response?: any;
    error?: any;
}>;
/**
 * Create a new File Search store
 *
 * POST /v1beta/fileSearchStores
 *
 * @param displayName - Human-readable name for the store
 */
export declare function createFileSearchStore(displayName: string): Promise<GeminiFileSearchStore>;
/**
 * Delete a File Search store
 *
 * DELETE /v1beta/{name=fileSearchStores/*}
 *
 * @param storeName - Store name (e.g., "fileSearchStores/my-store-123")
 */
export declare function deleteFileSearchStore(storeName: string): Promise<void>;
/**
 * Metadata for file upload
 */
export interface FileUploadMetadata {
    url: string;
    title: string;
    path?: string;
    lastUpdated?: string;
}
/**
 * Result of file upload
 */
export interface FileUploadResult {
    name: string;
    displayName?: string;
    mimeType: string;
    sizeBytes: string;
    createTime: string;
    state: string;
}
/**
 * Upload content to a File Search store using HTTP API
 *
 * POST /upload/v1beta/{fileSearchStoreName}:uploadToFileSearchStore
 *
 * Uses multipart/form-data with proper Content-Disposition headers
 *
 * @param storeName - Store name (e.g., "fileSearchStores/my-store-123")
 * @param content - Markdown content to upload
 * @param metadata - File metadata (url, title, path)
 */
export declare function uploadToFileSearchStore(storeName: string, content: string, metadata: FileUploadMetadata): Promise<FileUploadResult>;
/**
 * Configuration for batch uploads
 */
export declare const BATCH_CONFIG: {
    BATCH_SIZE: number;
    POLL_BATCH_SIZE: number;
    POLL_INTERVAL_MS: number;
    MAX_WAIT_TIME_MS: number;
    RATE_LIMIT_BACKOFF_MS: number;
    MAX_UPLOAD_RETRIES: number;
};
/**
 * Item to upload in a batch
 */
export interface BatchUploadItem {
    id: string;
    content: string;
    metadata: FileUploadMetadata;
}
/**
 * Result of a batch upload
 */
export interface BatchUploadResult {
    id: string;
    success: boolean;
    result?: FileUploadResult;
    error?: string;
}
/**
 * Upload multiple files to a store in batches with rate limiting
 *
 * NOTE: This is NOT a single batch API call - there is no batch upload endpoint in Gemini API.
 * This function processes multiple individual uploads in parallel (5 concurrent by default).
 * Each upload is a separate API call to the upload endpoint.
 *
 * @param storeName - Store to upload to
 * @param items - Array of items to upload
 * @param options - Batch options
 */
export declare function uploadFilesInBatches(storeName: string, items: BatchUploadItem[], options?: {
    batchSize?: number;
    onProgress?: (completed: number, total: number, item: BatchUploadResult) => void;
}): Promise<BatchUploadResult[]>;
//# sourceMappingURL=gemini-http.d.ts.map