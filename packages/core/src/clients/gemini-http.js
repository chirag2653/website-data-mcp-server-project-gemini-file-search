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
import { config } from '../config.js';
import { loggers } from '../utils/logger.js';
const log = loggers.gemini;
// API Base URLs
const API_BASE = 'https://generativelanguage.googleapis.com';
const API_ENDPOINT = `${API_BASE}/v1beta`;
const UPLOAD_ENDPOINT = `${API_BASE}/upload/v1beta`;
/**
 * Get API headers with authentication
 * Note: Gemini API uses x-goog-api-key header, NOT Bearer token
 */
function getHeaders() {
    return {
        'x-goog-api-key': config.gemini.apiKey,
        'Content-Type': 'application/json',
    };
}
// ============================================================================
// File Search Store Operations
// ============================================================================
/**
 * List all File Search stores owned by the user
 *
 * GET /v1beta/fileSearchStores
 *
 * @param options - Pagination options
 */
export async function listFileSearchStores(options) {
    log.info({ pageSize: options?.pageSize }, 'Listing File Search stores');
    try {
        const params = new URLSearchParams();
        if (options?.pageSize) {
            params.append('pageSize', String(options.pageSize));
        }
        if (options?.pageToken) {
            params.append('pageToken', options.pageToken);
        }
        const url = `${API_ENDPOINT}/fileSearchStores${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to list stores: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        const stores = (data.fileSearchStores || []).map((store) => ({
            name: store.name || '',
            displayName: store.displayName || '',
            createTime: store.createTime,
            updateTime: store.updateTime,
            activeDocumentsCount: store.activeDocumentsCount,
            pendingDocumentsCount: store.pendingDocumentsCount,
            failedDocumentsCount: store.failedDocumentsCount,
            sizeBytes: store.sizeBytes,
        }));
        log.info({ storeCount: stores.length, hasNextPage: !!data.nextPageToken }, 'File Search stores listed');
        return {
            fileSearchStores: stores,
            nextPageToken: data.nextPageToken,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ error: message }, 'Failed to list stores');
        throw new Error(`Failed to list File Search stores: ${message}`);
    }
}
/**
 * Get a File Search store by name with full details including document counts
 *
 * GET /v1beta/{name=fileSearchStores/*}
 */
export async function getFileSearchStore(storeName) {
    log.info({ storeName }, 'Getting File Search store');
    try {
        // Ensure storeName is in correct format
        const normalizedStoreName = storeName.startsWith('fileSearchStores/')
            ? storeName
            : `fileSearchStores/${storeName}`;
        const url = `${API_ENDPOINT}/${normalizedStoreName}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders(),
        });
        if (response.status === 404) {
            log.warn({ storeName }, 'Store not found');
            return null;
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get store: ${response.status} ${errorText}`);
        }
        const store = await response.json();
        return {
            name: store.name || normalizedStoreName,
            displayName: store.displayName || '',
            createTime: store.createTime,
            updateTime: store.updateTime,
            activeDocumentsCount: store.activeDocumentsCount,
            pendingDocumentsCount: store.pendingDocumentsCount,
            failedDocumentsCount: store.failedDocumentsCount,
            sizeBytes: store.sizeBytes,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Failed to get store');
        throw new Error(`Failed to get File Search store: ${message}`);
    }
}
// ============================================================================
// Document Operations
// ============================================================================
/**
 * List documents in a File Search store
 *
 * GET /v1beta/{parent=fileSearchStores/{store}}/documents
 *
 * @param storeName - Store name (e.g., "fileSearchStores/my-store-123")
 * @param options - Pagination options
 */
export async function listDocuments(storeName, options) {
    log.info({ storeName, pageSize: options?.pageSize }, 'Listing documents');
    try {
        // Ensure storeName is in correct format
        const normalizedStoreName = storeName.startsWith('fileSearchStores/')
            ? storeName
            : `fileSearchStores/${storeName}`;
        const params = new URLSearchParams();
        if (options?.pageSize) {
            params.append('pageSize', String(options.pageSize));
        }
        if (options?.pageToken) {
            params.append('pageToken', options.pageToken);
        }
        const url = `${API_ENDPOINT}/${normalizedStoreName}/documents${params.toString() ? `?${params.toString()}` : ''}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to list documents: ${response.status} ${errorText}`);
        }
        const data = await response.json();
        const documents = (data.documents || []).map((doc) => ({
            name: doc.name || '',
            displayName: doc.displayName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            createTime: doc.createTime,
            updateTime: doc.updateTime,
            state: doc.state,
        }));
        log.info({ storeName, documentCount: documents.length, hasNextPage: !!data.nextPageToken }, 'Documents listed');
        return {
            documents,
            nextPageToken: data.nextPageToken,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Failed to list documents');
        throw new Error(`Failed to list documents: ${message}`);
    }
}
/**
 * Get all documents in a store (handles pagination automatically)
 */
export async function listAllDocuments(storeName, maxResults) {
    const allDocuments = [];
    let pageToken;
    let pageCount = 0;
    const maxPages = 100; // Safety limit
    while (pageCount < maxPages) {
        const result = await listDocuments(storeName, {
            pageSize: 50,
            pageToken,
        });
        allDocuments.push(...result.documents);
        // Stop if we've reached maxResults
        if (maxResults && allDocuments.length >= maxResults) {
            return allDocuments.slice(0, maxResults);
        }
        // Stop if no more pages
        if (!result.nextPageToken) {
            break;
        }
        pageToken = result.nextPageToken;
        pageCount++;
    }
    return allDocuments;
}
/**
 * Get a single document by name
 *
 * GET /v1beta/{name=fileSearchStores/{store}/documents/{document}}
 */
export async function getDocument(documentName) {
    log.info({ documentName }, 'Getting document');
    try {
        // Ensure documentName is in correct format
        const normalizedDocName = documentName.startsWith('fileSearchStores/')
            ? documentName
            : documentName;
        const url = `${API_ENDPOINT}/${normalizedDocName}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders(),
        });
        if (response.status === 404) {
            throw new Error(`Document not found: ${documentName}`);
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get document: ${response.status} ${errorText}`);
        }
        const doc = await response.json();
        return {
            name: doc.name || normalizedDocName,
            displayName: doc.displayName,
            mimeType: doc.mimeType,
            sizeBytes: doc.sizeBytes,
            createTime: doc.createTime,
            updateTime: doc.updateTime,
            state: doc.state,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ documentName, error: message }, 'Failed to get document');
        throw new Error(`Failed to get document: ${message}`);
    }
}
/**
 * Delete a document from File Search store
 *
 * DELETE /v1beta/{name=fileSearchStores/{store}/documents/{document}}
 */
export async function deleteDocument(documentName) {
    log.info({ documentName }, 'Deleting document');
    try {
        // Ensure documentName is in correct format
        const normalizedDocName = documentName.startsWith('fileSearchStores/')
            ? documentName
            : documentName;
        const url = `${API_ENDPOINT}/${normalizedDocName}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        if (response.status === 404) {
            log.warn({ documentName }, 'Document not found, already deleted');
            return;
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete document: ${response.status} ${errorText}`);
        }
        log.info({ documentName }, 'Document deleted');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ documentName, error: message }, 'Failed to delete document');
        throw new Error(`Failed to delete document: ${message}`);
    }
}
// ============================================================================
// Operation Polling
// ============================================================================
/**
 * Get operation status
 *
 * GET /v1beta/{name=fileSearchStores/{store}/upload/operations/{operation}}
 * or
 * GET /v1beta/{name=fileSearchStores/{store}/operations/{operation}}
 */
export async function getOperation(operationName) {
    try {
        const url = `${API_ENDPOINT}/${operationName}`;
        const response = await fetch(url, {
            method: 'GET',
            headers: getHeaders(),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to get operation: ${response.status} ${errorText}`);
        }
        return await response.json();
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ operationName, error: message }, 'Failed to get operation');
        throw new Error(`Failed to get operation: ${message}`);
    }
}
/**
 * Poll an operation until it completes
 *
 * @param operationName - Full operation name
 * @param options - Polling options
 */
export async function pollOperation(operationName, options) {
    const pollInterval = options?.pollIntervalMs || 2000; // 2 seconds
    const maxWait = options?.maxWaitMs || 300000; // 5 minutes
    const startTime = Date.now();
    log.info({ operationName }, 'Polling operation');
    while (Date.now() - startTime < maxWait) {
        const operation = await getOperation(operationName);
        if (operation.done) {
            if (operation.error) {
                log.error({ operationName, error: operation.error }, 'Operation failed');
                throw new Error(`Operation failed: ${JSON.stringify(operation.error)}`);
            }
            log.info({ operationName, elapsed: `${((Date.now() - startTime) / 1000).toFixed(1)}s` }, 'Operation completed');
            return operation;
        }
        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    throw new Error(`Operation timed out after ${elapsed}s: ${operationName}`);
}
// ============================================================================
// File Search Store CRUD Operations
// ============================================================================
/**
 * Create a new File Search store
 *
 * POST /v1beta/fileSearchStores
 *
 * @param displayName - Human-readable name for the store
 */
export async function createFileSearchStore(displayName) {
    log.info({ displayName }, 'Creating File Search store');
    try {
        const url = `${API_ENDPOINT}/fileSearchStores`;
        const response = await fetch(url, {
            method: 'POST',
            headers: getHeaders(),
            body: JSON.stringify({
                displayName,
            }),
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create store: ${response.status} ${errorText}`);
        }
        const store = await response.json();
        log.info({ storeName: store.name, displayName }, 'File Search store created');
        return {
            name: store.name || '',
            displayName: store.displayName || displayName,
            createTime: store.createTime,
            updateTime: store.updateTime,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ displayName, error: message }, 'Failed to create store');
        throw new Error(`Failed to create File Search store: ${message}`);
    }
}
/**
 * Delete a File Search store
 *
 * DELETE /v1beta/{name=fileSearchStores/*}
 *
 * @param storeName - Store name (e.g., "fileSearchStores/my-store-123")
 */
export async function deleteFileSearchStore(storeName) {
    log.info({ storeName }, 'Deleting File Search store');
    try {
        // Ensure storeName is in correct format
        const normalizedStoreName = storeName.startsWith('fileSearchStores/')
            ? storeName
            : `fileSearchStores/${storeName}`;
        const url = `${API_ENDPOINT}/${normalizedStoreName}`;
        const response = await fetch(url, {
            method: 'DELETE',
            headers: getHeaders(),
        });
        if (response.status === 404) {
            log.warn({ storeName }, 'Store not found, already deleted');
            return;
        }
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to delete store: ${response.status} ${errorText}`);
        }
        log.info({ storeName }, 'File Search store deleted');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Failed to delete store');
        throw new Error(`Failed to delete File Search store: ${message}`);
    }
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
export async function uploadToFileSearchStore(storeName, content, metadata) {
    const contentSize = content.length;
    const contentSizeKB = (contentSize / 1024).toFixed(2);
    log.info({
        storeName,
        url: metadata.url,
        contentSize: `${contentSizeKB} KB`,
        title: metadata.title,
    }, 'Uploading to File Search store (HTTP)');
    try {
        // Ensure storeName is in correct format
        const normalizedStoreName = storeName.startsWith('fileSearchStores/')
            ? storeName
            : `fileSearchStores/${storeName}`;
        const fileName = `${sanitizeFilename(metadata.url)}.md`;
        // Build multipart body manually (Google API requires specific format)
        const boundary = '===============' + Date.now() + '===============';
        // Metadata JSON
        const metadataJson = JSON.stringify({
            displayName: metadata.title || metadata.url,
        });
        // Build multipart body with proper Content-Disposition headers
        const body = [
            `--${boundary}`,
            'Content-Type: application/json',
            'Content-Disposition: form-data; name="metadata"',
            '',
            metadataJson,
            `--${boundary}`,
            'Content-Type: text/markdown',
            `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
            '',
            content,
            `--${boundary}--`
        ].join('\r\n');
        // Upload endpoint
        const url = `${UPLOAD_ENDPOINT}/${normalizedStoreName}:uploadToFileSearchStore`;
        log.debug({ url, fileName, contentSize: `${contentSizeKB} KB` }, 'Starting upload');
        const uploadStartTime = Date.now();
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'x-goog-api-key': config.gemini.apiKey,
                'Content-Type': `multipart/form-data; boundary=${boundary}`,
            },
            body: body,
        });
        const uploadTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Upload failed: ${response.status} ${errorText}`);
        }
        const operation = await response.json();
        log.debug({
            operationName: operation.name,
            done: !!operation.response,
            uploadTime: `${uploadTime}s`,
        }, 'Upload operation initiated');
        // Extract document name from response
        const documentName = operation.response?.documentName || operation.name || '';
        // If operation has response, it's already complete (common for small files)
        if (operation.response) {
            log.info({ documentName, uploadTime: `${uploadTime}s` }, 'Upload completed immediately');
            return {
                name: documentName,
                displayName: metadata.title,
                mimeType: operation.response.mimeType || 'text/markdown',
                sizeBytes: operation.response.sizeBytes || String(contentSize),
                createTime: new Date().toISOString(),
                state: 'ACTIVE',
            };
        }
        // Poll for operation completion (rare for small files)
        if (operation.name) {
            const completedOp = await pollOperation(operation.name, {
                pollIntervalMs: 2000,
                maxWaitMs: 300000, // 5 minutes
            });
            if (completedOp.error) {
                throw new Error(`Operation failed: ${JSON.stringify(completedOp.error)}`);
            }
            // Extract document info from completed operation
            const doc = completedOp.response;
            return {
                name: doc?.documentName || operation.name,
                displayName: metadata.title,
                mimeType: 'text/markdown',
                sizeBytes: String(contentSize),
                createTime: new Date().toISOString(),
                state: 'ACTIVE',
            };
        }
        // Fallback
        return {
            name: documentName,
            displayName: metadata.title,
            mimeType: 'text/markdown',
            sizeBytes: String(contentSize),
            createTime: new Date().toISOString(),
            state: 'PENDING',
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({
            storeName,
            url: metadata.url,
            contentSize: `${contentSizeKB} KB`,
            error: message,
        }, 'Upload failed');
        throw new Error(`Failed to upload to File Search store: ${message}`);
    }
}
// ============================================================================
// Batch Upload Operations
// ============================================================================
/**
 * Configuration for batch uploads
 */
export const BATCH_CONFIG = {
    BATCH_SIZE: 5, // Concurrent uploads per batch
    POLL_BATCH_SIZE: 5, // Concurrent operation polls
    POLL_INTERVAL_MS: 2000, // 2 seconds between polls
    MAX_WAIT_TIME_MS: 300000, // 5 minutes max wait per file
    RATE_LIMIT_BACKOFF_MS: 2000, // Base backoff on 429
    MAX_UPLOAD_RETRIES: 3, // Max retries for upload errors
};
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
export async function uploadFilesInBatches(storeName, items, options) {
    const batchSize = options?.batchSize || BATCH_CONFIG.BATCH_SIZE;
    const results = [];
    log.info({ storeName, totalItems: items.length, batchSize }, 'Starting batch upload');
    // Process items in batches
    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchNumber = Math.floor(i / batchSize) + 1;
        const totalBatches = Math.ceil(items.length / batchSize);
        log.info({ batchNumber, totalBatches, batchItems: batch.length }, 'Processing batch');
        // Process batch items in parallel
        const batchPromises = batch.map(async (item) => {
            try {
                const result = await uploadToFileSearchStore(storeName, item.content, item.metadata);
                return {
                    id: item.id,
                    success: true,
                    result,
                };
            }
            catch (error) {
                const message = error instanceof Error ? error.message : 'Unknown error';
                // Check for rate limit
                if (message.includes('429') || message.includes('rate limit') || message.includes('quota')) {
                    log.warn({ itemId: item.id }, 'Rate limited, will retry');
                    // Wait and retry once
                    await new Promise(resolve => setTimeout(resolve, BATCH_CONFIG.RATE_LIMIT_BACKOFF_MS));
                    try {
                        const retryResult = await uploadToFileSearchStore(storeName, item.content, item.metadata);
                        return {
                            id: item.id,
                            success: true,
                            result: retryResult,
                        };
                    }
                    catch (retryError) {
                        const retryMessage = retryError instanceof Error ? retryError.message : 'Unknown error';
                        return {
                            id: item.id,
                            success: false,
                            error: retryMessage,
                        };
                    }
                }
                return {
                    id: item.id,
                    success: false,
                    error: message,
                };
            }
        });
        const batchResults = await Promise.all(batchPromises);
        // Report progress and collect results
        for (const result of batchResults) {
            results.push(result);
            options?.onProgress?.(results.length, items.length, result);
        }
        // Brief pause between batches to avoid rate limits
        if (i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, 500));
        }
    }
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    log.info({ storeName, total: items.length, successful, failed }, 'Batch upload complete');
    return results;
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Sanitize URL for use as filename
 */
function sanitizeFilename(url) {
    return url
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 100);
}
//# sourceMappingURL=gemini-http.js.map