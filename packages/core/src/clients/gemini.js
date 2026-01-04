/**
 * Gemini File Search client for semantic indexing and retrieval
 */
import { GoogleGenAI } from '@google/genai';
import { config } from '../config.js';
import { loggers } from '../utils/logger.js';
const log = loggers.gemini;
// Initialize Gemini client
const genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
// ============================================================================
// File Search Store Operations
// ============================================================================
/**
 * Create a new File Search store
 */
export async function createFileSearchStore(displayName) {
    log.info({ displayName }, 'Creating File Search store');
    try {
        const store = await genai.fileSearchStores.create({
            config: { displayName },
        });
        log.info({ storeName: store.name, displayName }, 'File Search store created');
        return {
            name: store.name,
            displayName: store.displayName ?? displayName,
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
 * Get a File Search store by name
 * Returns store information including document counts
 */
export async function getFileSearchStore(name) {
    try {
        const store = await genai.fileSearchStores.get({ name });
        return {
            name: store.name,
            displayName: store.displayName ?? '',
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
        if (message.includes('not found') || message.includes('404')) {
            return null;
        }
        throw new Error(`Failed to get File Search store: ${message}`);
    }
}
/**
 * List documents in a File Search store
 * According to API docs: https://ai.google.dev/api/file-search/documents
 * The SDK returns a Pager - we'll use it to get all documents
 */
export async function listDocumentsInStore(storeName, options) {
    log.info({ storeName, maxResults: options?.maxResults }, 'Listing documents in store');
    try {
        // Ensure storeName is in correct format
        const normalizedStoreName = storeName.startsWith('fileSearchStores/')
            ? storeName
            : `fileSearchStores/${storeName}`;
        const documents = [];
        // The SDK returns a Pager - iterate through it using async iteration
        // The Pager is an async iterable, so we use for-await-of
        const pagerResult = genai.fileSearchStores.documents.list({
            parent: normalizedStoreName,
        });
        // Await if it's a Promise, otherwise use directly
        const pager = pagerResult instanceof Promise ? await pagerResult : pagerResult;
        // Use async iteration to iterate through the pager
        let pageCount = 0;
        const maxPages = 100; // Safety limit
        try {
            for await (const page of pager) {
                if (pageCount >= maxPages) {
                    break;
                }
                // page might be an array of documents or a single document
                const pageDocs = Array.isArray(page) ? page : [page];
                for (const doc of pageDocs) {
                    documents.push({
                        name: doc.name || '',
                        displayName: doc.displayName,
                        mimeType: doc.mimeType,
                        sizeBytes: doc.sizeBytes,
                        createTime: doc.createTime,
                        updateTime: doc.updateTime,
                        state: doc.state,
                    });
                    // Stop if we've reached maxResults
                    if (options?.maxResults && documents.length >= options.maxResults) {
                        break;
                    }
                }
                // Stop if we've reached maxResults
                if (options?.maxResults && documents.length >= options.maxResults) {
                    break;
                }
                pageCount++;
            }
        }
        catch (iterError) {
            // If async iteration fails, the pager might not be iterable
            // Log and continue with empty results or throw
            log.warn({ storeName, error: iterError }, 'Failed to iterate pager, may not be async iterable');
            // Continue with whatever documents we collected so far
        }
        log.info({ storeName, documentCount: documents.length }, 'Documents listed');
        return {
            documents: options?.maxResults ? documents.slice(0, options.maxResults) : documents,
            totalCount: documents.length,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Failed to list documents');
        throw new Error(`Failed to list documents: ${message}`);
    }
}
/**
 * Delete a File Search store
 */
export async function deleteFileSearchStore(name) {
    log.info({ storeName: name }, 'Deleting File Search store');
    try {
        await genai.fileSearchStores.delete({ name });
        log.info({ storeName: name }, 'File Search store deleted');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName: name, error: message }, 'Failed to delete store');
        throw new Error(`Failed to delete File Search store: ${message}`);
    }
}
// ============================================================================
// File Upload Operations
// ============================================================================
/**
 * Upload content directly to a File Search store
 */
export async function uploadToFileSearchStore(storeName, content, metadata) {
    const contentSize = content.length;
    const contentSizeKB = (contentSize / 1024).toFixed(2);
    log.info({
        storeName,
        url: metadata.url,
        contentSize: `${contentSizeKB} KB`,
        title: metadata.title
    }, 'Uploading to File Search store');
    try {
        // Create a text file from content
        const blob = new Blob([content], { type: 'text/markdown' });
        const file = new File([blob], `${sanitizeFilename(metadata.url)}.md`, {
            type: 'text/markdown',
        });
        log.debug({ fileName: file.name, fileSize: `${contentSizeKB} KB` }, 'File created, starting upload');
        // Upload to File Search store
        // Note: The SDK API may vary, using type assertion for flexibility
        const uploadParams = {
            fileSearchStoreName: storeName,
            file,
            config: {
                displayName: metadata.title || metadata.url,
            },
        };
        log.debug({ storeName, displayName: uploadParams.config?.displayName }, 'Calling uploadToFileSearchStore');
        const uploadStartTime = Date.now();
        const operation = await genai.fileSearchStores.uploadToFileSearchStore(uploadParams);
        // Validate operation response
        if (!operation || typeof operation !== 'object') {
            throw new Error('Invalid operation response from Gemini API: operation is not an object');
        }
        const uploadInitTime = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
        log.debug({
            operationName: operation.name,
            done: operation.done,
            hasName: !!operation.name,
            hasResponse: !!operation.response,
            uploadInitTime: `${uploadInitTime}s`
        }, 'Upload operation initiated');
        // Wait for the operation to complete
        const result = await waitForOperation(operation);
        log.info({ storeName, url: metadata.url }, 'File uploaded');
        // Extract document name from operation result
        // The operation result should contain the document resource name
        // Format: fileSearchStores/{store}/documents/{document-id}
        // If result.name is the operation name, we may need to extract from result.response
        let documentName;
        // Try to get document name from result
        // The SDK may return it in result.name (document name) or result.response (operation response)
        if (result.name && result.name.startsWith('fileSearchStores/')) {
            // Already a document name
            documentName = result.name;
        }
        else {
            // May need to construct or extract from response
            // For now, use result.name if available, otherwise construct a placeholder
            // The delete function will handle construction if needed
            documentName = result.name ?? `file-${Date.now()}`;
            // Log warning if we're not getting expected format
            if (!result.name) {
                log.warn({ storeName, url: metadata.url }, 'Operation result missing name field');
            }
        }
        return {
            name: documentName,
            displayName: metadata.title,
            mimeType: 'text/markdown',
            sizeBytes: String(content.length),
            createTime: new Date().toISOString(),
            state: 'ACTIVE',
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        const stack = error instanceof Error ? error.stack : undefined;
        log.error({
            storeName,
            url: metadata.url,
            contentSize: `${contentSizeKB} KB`,
            error: message,
            stack: stack?.substring(0, 500) // First 500 chars of stack
        }, 'Upload failed');
        // Provide more helpful error message
        let errorMessage = `Failed to upload file to Gemini File Search: ${message}`;
        if (message.includes('timeout')) {
            errorMessage += ` (File size: ${contentSizeKB} KB). The upload may take longer for large files.`;
        }
        else if (message.includes('quota') || message.includes('limit')) {
            errorMessage += ' Check your Gemini API quota and limits.';
        }
        else if (message.includes('permission') || message.includes('unauthorized')) {
            errorMessage += ' Check your Gemini API key permissions and File Search access.';
        }
        throw new Error(errorMessage);
    }
}
/**
 * Delete a document from File Search store
 *
 * According to Gemini API docs: https://ai.google.dev/api/file-search/documents
 * Uses fileSearchStores.documents.delete() method
 *
 * @param storeName - The FileSearchStore name (e.g., "fileSearchStores/my-store-123")
 * @param documentName - The full document name (e.g., "fileSearchStores/my-store-123/documents/doc-abc")
 *                       OR just the document ID (will be constructed if needed)
 */
export async function deleteFileFromStore(storeName, documentName) {
    log.debug({ storeName, documentName }, 'Deleting document from store');
    try {
        // Construct full document name if needed
        // Document name format: fileSearchStores/{store}/documents/{document}
        let fullDocumentName;
        if (documentName.startsWith('fileSearchStores/')) {
            // Already full name
            fullDocumentName = documentName;
        }
        else {
            // Just document ID, construct full name
            // Ensure storeName is in correct format
            const normalizedStoreName = storeName.startsWith('fileSearchStores/')
                ? storeName
                : `fileSearchStores/${storeName}`;
            fullDocumentName = `${normalizedStoreName}/documents/${documentName}`;
        }
        // Use fileSearchStores.documents.delete() as per API docs
        await genai.fileSearchStores.documents.delete({
            name: fullDocumentName
        });
        log.info({ storeName, documentName: fullDocumentName }, 'Document deleted');
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // If document not found (404), ignore it - it's already gone
        if (message.includes('404') || message.includes('not found') || message.includes('NOT_FOUND')) {
            log.warn({ documentName, error: message }, 'Document not found, already deleted');
            return;
        }
        log.error({ documentName, error: message }, 'Failed to delete document');
        throw new Error(`Failed to delete document: ${message}`);
    }
}
// ============================================================================
// Search Operations
// ============================================================================
/**
 * Query the File Search store with a question
 *
 * @param storeName - The File Search store name
 * @param question - The question to ask
 * @param options - Optional configuration
 * @param options.metadataFilter - Filter documents by metadata (JSON string)
 *
 * @returns Search response with answer, citations, and grounding metadata
 *
 * @note Chunk Limitation:
 * - Gemini typically returns ~5 chunks from 2-3 unique documents per query
 * - There is NO documented parameter to control or increase chunk count
 * - This is a known API limitation (see: https://discuss.ai.google.dev/t/investigating-undocumented-file-search-retrieval-limits)
 * - The API manages retrieval internally based on relevance
 */
export async function searchWithFileSearch(storeName, question, options) {
    log.info({ storeName, question: question.slice(0, 100) }, 'Executing search');
    try {
        // Follow the exact API structure from official docs:
        // https://ai.google.dev/gemini-api/docs/file-search#javascript
        const response = await genai.models.generateContent({
            model: config.gemini.model,
            contents: question,
            config: {
                tools: [
                    {
                        fileSearch: {
                            fileSearchStoreNames: [storeName],
                            metadataFilter: options?.metadataFilter,
                        },
                    },
                ],
            },
        });
        // Extract answer text
        const answer = response.text ?? '';
        // Extract citations from grounding metadata
        // According to Gemini API docs: https://ai.google.dev/gemini-api/docs/file-search
        // Citations are provided via groundingMetadata.groundingChunks
        // Each chunk contains retrievedContext with the document content used
        const sources = extractCitations(response);
        // Log chunk statistics for monitoring
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        const chunkCount = groundingMetadata?.groundingChunks?.length ?? 0;
        const uniqueDocuments = new Set(groundingMetadata?.groundingChunks?.map(chunk => {
            const ctx = chunk.retrievedContext;
            return ctx?.title || ctx?.uri || 'unknown';
        }) ?? []).size;
        log.info({
            storeName,
            sourceCount: sources.length,
            chunkCount,
            uniqueDocuments,
            note: 'Gemini typically returns ~5 chunks from 2-3 documents (no control parameter available)'
        }, 'Search completed');
        return {
            answer,
            sources,
            groundingMetadata: response.candidates?.[0]?.groundingMetadata,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Search failed');
        throw new Error(`Search failed: ${message}`);
    }
}
/**
 * Search with structured output
 */
export async function searchWithStructuredOutput(storeName, question, schema) {
    log.info({ storeName }, 'Executing structured search');
    try {
        const response = await genai.models.generateContent({
            model: config.gemini.model,
            contents: question,
            config: {
                tools: [
                    {
                        fileSearch: {
                            fileSearchStoreNames: [storeName],
                        },
                    },
                ],
                responseMimeType: 'application/json',
                responseSchema: schema,
            },
        });
        const data = JSON.parse(response.text ?? '{}');
        const sources = extractCitations(response);
        return { data, sources };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Structured search failed');
        throw new Error(`Structured search failed: ${message}`);
    }
}
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Wait for an async operation to complete
 * Increased timeout to 5 minutes for large file uploads
 */
async function waitForOperation(operation, maxWaitMs = 300000 // 5 minutes for large files
) {
    const startTime = Date.now();
    const pollInterval = 2000; // Poll every 2 seconds
    let lastStatus = null;
    log.debug({ operationName: operation.name, done: operation.done }, 'Waiting for operation');
    // Check if already done
    if (operation.done) {
        log.debug('Operation already complete');
        return operation;
    }
    // If no operation name, the operation might be synchronous or already complete
    if (!operation.name) {
        log.warn({ hasResponse: !!operation.response, done: operation.done }, 'Operation has no name, checking if complete');
        // Wait a bit to see if it completes
        await new Promise((resolve) => setTimeout(resolve, 2000));
        if (operation.done) {
            log.info('Operation completed (no name but done=true)');
            return operation;
        }
        // If still not done and no name, check if response is available
        if (operation.response) {
            log.info('Operation has response, assuming complete');
            return operation;
        }
        // If operation has no name and is not done, we can't poll it
        // This might be a synchronous operation that completed immediately
        log.warn('Operation has no name and is not done - cannot poll, assuming it will complete');
        // Return the operation as-is - the calling code should handle this
        return operation;
    }
    // Poll operation status
    let attempt = 0;
    while (Date.now() - startTime < maxWaitMs) {
        attempt++;
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        try {
            // Validate operation name before polling
            if (!operation.name) {
                throw new Error('Cannot poll operation: operation.name is missing');
            }
            // According to docs: https://ai.google.dev/api/file-search/file-search-stores
            // Upload operations return operation.name in format: fileSearchStores/{store}/upload/operations/{operation}
            // The SDK's genai.operations.get() should handle this, but there's a known SDK issue
            // We'll use genai.operations.get() with proper error handling and fallback
            // Validate genai.operations exists
            if (!genai.operations || typeof genai.operations.get !== 'function') {
                throw new Error('genai.operations.get is not available');
            }
            // Poll operation status - the SDK should handle the operation name format
            // Note: There's a known SDK issue where it may throw "Cannot read properties of undefined (reading 'name')"
            // We handle this gracefully with a fallback mechanism
            const getParams = { name: operation.name };
            const status = await genai.operations.get(getParams);
            // Validate status response
            if (!status || typeof status !== 'object') {
                throw new Error(`Invalid operation status response: ${typeof status} (expected object)`);
            }
            lastStatus = status;
            log.debug({
                attempt,
                elapsed: `${elapsed}s`,
                done: status.done,
                operationName: operation.name,
                hasName: !!status.name,
                hasResponse: !!status.response
            }, 'Polling operation status');
            if (status.done) {
                log.info({ elapsed: `${elapsed}s`, attempt }, 'Operation completed');
                return status;
            }
            // Check for errors in status
            if (status.error) {
                const error = status.error;
                throw new Error(`Operation failed: ${error?.message || 'Unknown error'} (code: ${error?.code || 'unknown'})`);
            }
        }
        catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            // If it's a 404, the operation might not exist yet - continue polling
            if (message.includes('404') || message.includes('not found') || message.includes('NOT_FOUND')) {
                log.debug({ attempt, elapsed: `${elapsed}s` }, 'Operation not found yet, continuing to poll');
            }
            else if (message.includes('Cannot read properties of undefined') || message.includes('reading \'name\'')) {
                // Known SDK issue - operations complete successfully but polling has internal errors
                // Reduce log verbosity - only log first occurrence at debug level
                if (attempt === 1) {
                    log.debug({
                        operationName: operation.name,
                        note: 'Known SDK polling issue - operation will complete successfully'
                    }, 'SDK polling error (non-critical, will use fallback)');
                }
                // Fast fallback: Check if operation has response (operations often complete despite polling errors)
                // This is a workaround for the SDK issue - the operation completes but polling fails
                if (operation.response) {
                    // Operation is complete - return immediately without more polling attempts
                    log.debug({ attempt, elapsed: `${elapsed}s` }, 'Operation complete (using response fallback)');
                    return { name: operation.name, response: operation.response };
                }
                // If no response yet, wait a bit and check again (operations may complete quickly)
                if (attempt >= 2) {
                    // Wait a bit longer before checking response again
                    await new Promise((resolve) => setTimeout(resolve, 1000));
                    if (operation.response) {
                        log.debug({ attempt, elapsed: `${elapsed}s` }, 'Operation complete after brief wait');
                        return { name: operation.name, response: operation.response };
                    }
                }
                // If still no response after reasonable attempts, continue polling silently
                // The operation will eventually complete or timeout
                if (attempt >= 10) {
                    log.warn({ attempt, operationName: operation.name, elapsed: `${elapsed}s` }, 'Operation polling taking longer than expected');
                }
            }
            else {
                // Other errors - log but continue polling (might be transient)
                log.warn({ attempt, elapsed: `${elapsed}s`, error: message }, 'Error polling operation, continuing');
            }
        }
        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
    // Timeout reached
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log.error({
        elapsed: `${elapsed}s`,
        maxWaitMs,
        operationName: operation.name,
        lastStatus: JSON.stringify(lastStatus).substring(0, 200)
    }, 'Operation timed out');
    throw new Error(`Operation timed out after ${elapsed}s. ` +
        `Operation name: ${operation.name || 'unknown'}. ` +
        `Last status: ${JSON.stringify(lastStatus).substring(0, 200)}`);
}
/**
 * Extract citations from response
 */
function extractCitations(response) {
    const metadata = response.candidates?.[0]?.groundingMetadata;
    if (!metadata) {
        return [];
    }
    if (!metadata.groundingChunks || metadata.groundingChunks.length === 0) {
        return [];
    }
    const seen = new Set();
    const sources = [];
    // Extract citations from grounding chunks
    // According to Gemini API docs: https://ai.google.dev/gemini-api/docs/file-search
    // - Citations are provided via groundingMetadata.groundingChunks
    // - Each chunk contains retrievedContext with document content
    // - retrievedContext.text contains the document content used
    // - retrievedContext.title contains the displayName we set during upload
    // - NOTE: retrievedContext does NOT always include URI (known limitation)
    // - URLs must be extracted from the text content (markdown contains URLs)
    for (const chunk of metadata.groundingChunks) {
        const retrievedContext = chunk.retrievedContext; // SDK returns more fields than typed
        // Try to get URI from different possible locations (may not exist)
        let uri = retrievedContext?.uri
            || retrievedContext?.sourceUri
            || retrievedContext?.documentUri
            || chunk.uri;
        // If no URI found directly, extract from text (URLs are embedded in markdown)
        // This is the standard approach - Gemini doesn't provide URI in retrievedContext
        // The URL is embedded in the markdown content we uploaded
        if (!uri && retrievedContext?.text) {
            const urlMatch = retrievedContext.text.match(/https?:\/\/[^\s\)]+/);
            if (urlMatch) {
                // Clean up the URL (remove trailing fragments like #content or closing parentheses)
                uri = urlMatch[0].split('#')[0].split(')')[0].trim();
            }
        }
        // Title comes from displayName we set during upload
        const title = retrievedContext?.title || chunk.title;
        if (uri && !seen.has(uri)) {
            seen.add(uri);
            sources.push({ uri, title });
        }
    }
    return sources;
}
/**
 * Sanitize URL for use as filename
 */
function sanitizeFilename(url) {
    return url
        .replace(/^https?:\/\//, '')
        .replace(/[^a-zA-Z0-9-_]/g, '_')
        .slice(0, 100);
}
// Export client for direct access if needed
export { genai };
//# sourceMappingURL=gemini.js.map