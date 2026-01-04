/**
 * Cleanup service for Gemini File Search stores and documents
 * 
 * This is a SERVICE - reusable functions that can be imported in other code.
 * 
 * Service vs Script Pattern:
 * - SERVICE (this file): Contains business logic as reusable functions
 *   → Can be imported: import * as cleanupService from './services/cleanup.js'
 *   → Used by: other services, scripts, MCP tools, etc.
 * 
 * - SCRIPT (scripts/cleanup-gemini.ts): Executable entry point
 *   → Can be run: npm run cleanup
 *   → Uses this service internally
 *   → Provides command-line interface
 * 
 * Use this service to clean up existing stores/documents before running fresh ingestion.
 */

import * as geminiHttp from '../clients/gemini-http.js';
import { loggers } from '../utils/logger.js';

const log = loggers.ingestion; // Reuse ingestion logger

// Retry configuration
const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  RETRY_DELAY_MS: 2000, // 2 seconds base delay
  RATE_LIMIT_DELAY_MS: 5000, // 5 seconds for rate limits
  PAGINATION_DELAY_MS: 500, // Small delay between pagination requests
};

export interface CleanupResult {
  storesDeleted: number;
  documentsDeleted: number;
  stores: Array<{
    name: string;
    displayName: string;
    documentsDeleted: number;
  }>;
  errors: Array<{
    store?: string;
    document?: string;
    error: string;
  }>;
}

/**
 * Check if an error is retryable (rate limit, try again, etc.)
 */
function isRetryableError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowerMessage = message.toLowerCase();
  
  return (
    lowerMessage.includes('429') ||
    lowerMessage.includes('rate limit') ||
    lowerMessage.includes('quota') ||
    lowerMessage.includes('try again') ||
    lowerMessage.includes('resource_exhausted') ||
    lowerMessage.includes('too many requests')
  );
}

/**
 * Retry an async operation with exponential backoff
 */
async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = RETRY_CONFIG.MAX_RETRIES,
  baseDelayMs: number = RETRY_CONFIG.RETRY_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Don't retry if it's not a retryable error
      if (!isRetryableError(error)) {
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt === maxRetries) {
        break;
      }
      
      // Calculate delay with exponential backoff
      const delayMs = baseDelayMs * Math.pow(2, attempt);
      log.warn(
        { attempt: attempt + 1, maxRetries, delayMs, error: error instanceof Error ? error.message : String(error) },
        'Retryable error, retrying with backoff'
      );
      
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
  
  throw lastError;
}

/**
 * Clean up all documents from all File Search stores
 * Optionally delete the stores themselves
 * 
 * @param deleteStores - If true, delete stores after cleaning documents (default: false)
 * @param storeFilter - Optional: only clean stores matching this name pattern
 */
export async function cleanupGeminiStores(
  options?: {
    deleteStores?: boolean;
    storeFilter?: string; // Optional filter to only clean specific stores
  }
): Promise<CleanupResult> {
  const { deleteStores = false, storeFilter } = options ?? {};
  const result: CleanupResult = {
    storesDeleted: 0,
    documentsDeleted: 0,
    stores: [],
    errors: [],
  };

  log.info({ deleteStores, storeFilter }, 'Starting Gemini File Search cleanup');

  try {
    // Step 1: List all File Search stores
    log.info('Listing all File Search stores');
    let allStores: Array<{ name: string; displayName: string }> = [];
    let pageToken: string | undefined;
    let pageCount = 0;
    const maxPages = 100; // Safety limit
    const seenPageTokens = new Set<string>(); // Prevent infinite loops

    while (pageCount < maxPages) {
      // Prevent infinite loop if same pageToken is returned
      if (pageToken && seenPageTokens.has(pageToken)) {
        log.warn({ pageToken }, 'Detected duplicate pageToken, stopping pagination');
        break;
      }
      if (pageToken) {
        seenPageTokens.add(pageToken);
      }

      // Add small delay between pagination requests to avoid rate limits
      if (pageCount > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PAGINATION_DELAY_MS));
      }

      const listResult = await retryWithBackoff(
        () => geminiHttp.listFileSearchStores({
          pageSize: 20,
          pageToken,
        }),
        RETRY_CONFIG.MAX_RETRIES,
        RETRY_CONFIG.RATE_LIMIT_DELAY_MS
      );

      allStores.push(...listResult.fileSearchStores.map(store => ({
        name: store.name,
        displayName: store.displayName,
      })));

      // Break if no nextPageToken or if it's an empty string
      if (!listResult.nextPageToken || listResult.nextPageToken.trim() === '') {
        break;
      }

      pageToken = listResult.nextPageToken;
      pageCount++;
    }

    log.info({ totalStores: allStores.length }, 'Found File Search stores');

    // Filter stores if filter provided
    if (storeFilter) {
      allStores = allStores.filter(store => 
        store.name.includes(storeFilter) || store.displayName.includes(storeFilter)
      );
      log.info({ filteredStores: allStores.length }, 'Filtered stores');
    }

    if (allStores.length === 0) {
      log.info('No stores found to clean');
      return result;
    }

    // Step 2: For each store, delete all documents
    for (const store of allStores) {
      log.info({ storeName: store.name, displayName: store.displayName }, 'Cleaning store');

      let documentsDeleted = 0;

      try {
        // FIRST: Collect ALL document names (avoid pagination issues during deletion)
        log.info({ storeName: store.name }, 'Collecting all document names');
        const allDocumentNames: string[] = [];
        let docPageToken: string | undefined;
        let docPageCount = 0;
        const maxDocPages = 100; // Safety limit
        const seenDocPageTokens = new Set<string>(); // Prevent infinite loops
        
        while (docPageCount < maxDocPages) {
          // Prevent infinite loop if same pageToken is returned
          if (docPageToken && seenDocPageTokens.has(docPageToken)) {
            log.warn({ storeName: store.name, pageToken: docPageToken }, 'Detected duplicate pageToken, stopping pagination');
            break;
          }
          if (docPageToken) {
            seenDocPageTokens.add(docPageToken);
          }

          // Add small delay between pagination requests to avoid rate limits
          if (docPageCount > 0) {
            await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PAGINATION_DELAY_MS));
          }

          const docListResult = await retryWithBackoff(
            () => geminiHttp.listDocuments(store.name, {
              pageSize: 20,
              pageToken: docPageToken,
            }),
            RETRY_CONFIG.MAX_RETRIES,
            RETRY_CONFIG.RATE_LIMIT_DELAY_MS
          );

          // Collect document names (don't delete yet)
          for (const doc of docListResult.documents) {
            allDocumentNames.push(doc.name);
          }

          // If we got 0 documents but still have a nextPageToken, something is wrong - break
          if (docListResult.documents.length === 0 && docListResult.nextPageToken) {
            log.warn({ storeName: store.name, pageToken: docListResult.nextPageToken }, 'Got empty result with nextPageToken, stopping pagination');
            break;
          }

          // Break if no nextPageToken or if it's an empty string
          if (!docListResult.nextPageToken || docListResult.nextPageToken.trim() === '') {
            break;
          }

          docPageToken = docListResult.nextPageToken;
          docPageCount++;
        }

        log.info({ storeName: store.name, documentCount: allDocumentNames.length }, 'Collected all document names, starting deletion');

        // SECOND: Delete all collected documents
        for (const docName of allDocumentNames) {
          try {
            await retryWithBackoff(
              () => geminiHttp.deleteDocument(docName),
              RETRY_CONFIG.MAX_RETRIES,
              RETRY_CONFIG.RATE_LIMIT_DELAY_MS
            );
            documentsDeleted++;
            result.documentsDeleted++;

            if (documentsDeleted % 10 === 0) {
              log.debug({ storeName: store.name, deleted: documentsDeleted, total: allDocumentNames.length }, 'Documents deleted');
            }

            // Small delay between document deletions to avoid rate limits
            await new Promise(resolve => setTimeout(resolve, 100));
          } catch (docError) {
            const message = docError instanceof Error ? docError.message : 'Unknown error';
            log.warn({ storeName: store.name, documentName: docName, error: message }, 'Failed to delete document after retries');
            result.errors.push({
              store: store.name,
              document: docName,
              error: message,
            });
          }
        }

        log.info(
          { storeName: store.name, documentsDeleted },
          'Store documents cleaned'
        );

        result.stores.push({
          name: store.name,
          displayName: store.displayName,
          documentsDeleted,
        });

        // Step 3: Delete store if requested
        if (deleteStores) {
          try {
            await retryWithBackoff(
              () => geminiHttp.deleteFileSearchStore(store.name),
              RETRY_CONFIG.MAX_RETRIES,
              RETRY_CONFIG.RATE_LIMIT_DELAY_MS
            );
            result.storesDeleted++;
            log.info({ storeName: store.name }, 'Store deleted');
          } catch (storeError) {
            const message = storeError instanceof Error ? storeError.message : 'Unknown error';
            log.error({ storeName: store.name, error: message }, 'Failed to delete store after retries');
            result.errors.push({
              store: store.name,
              error: message,
            });
          }
        }
      } catch (storeError) {
        const message = storeError instanceof Error ? storeError.message : 'Unknown error';
        log.error({ storeName: store.name, error: message }, 'Failed to clean store');
        result.errors.push({
          store: store.name,
          error: message,
        });
      }
    }

    log.info(
      {
        storesProcessed: allStores.length,
        storesDeleted: result.storesDeleted,
        documentsDeleted: result.documentsDeleted,
        errors: result.errors.length,
      },
      'Cleanup complete'
    );

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: message }, 'Cleanup failed');
    throw new Error(`Failed to cleanup Gemini stores: ${message}`);
  }
}

/**
 * Clean up documents from a specific store
 * 
 * @param storeName - Store name to clean
 * @param deleteStore - If true, delete the store after cleaning documents (default: false)
 */
export async function cleanupGeminiStore(
  storeName: string,
  options?: {
    deleteStore?: boolean;
  }
): Promise<{
  documentsDeleted: number;
  storeDeleted: boolean;
  errors: Array<{ document?: string; error: string }>;
}> {
  const { deleteStore = false } = options ?? {};
  const result = {
    documentsDeleted: 0,
    storeDeleted: false,
    errors: [] as Array<{ document?: string; error: string }>,
  };

  log.info({ storeName, deleteStore }, 'Cleaning specific store');

  try {
    // Verify store exists
    const store = await geminiHttp.getFileSearchStore(storeName);
    if (!store) {
      throw new Error(`Store not found: ${storeName}`);
    }

    // FIRST: Collect ALL document names (avoid pagination issues during deletion)
    log.info({ storeName }, 'Collecting all document names');
    const allDocumentNames: string[] = [];
    let docPageToken: string | undefined;
    let docPageCount = 0;
    const maxDocPages = 100;
    const seenDocPageTokens = new Set<string>(); // Prevent infinite loops

    while (docPageCount < maxDocPages) {
      // Prevent infinite loop if same pageToken is returned
      if (docPageToken && seenDocPageTokens.has(docPageToken)) {
        log.warn({ storeName, pageToken: docPageToken }, 'Detected duplicate pageToken, stopping pagination');
        break;
      }
      if (docPageToken) {
        seenDocPageTokens.add(docPageToken);
      }

      // Add small delay between pagination requests to avoid rate limits
      if (docPageCount > 0) {
        await new Promise(resolve => setTimeout(resolve, RETRY_CONFIG.PAGINATION_DELAY_MS));
      }

      const docListResult = await retryWithBackoff(
        () => geminiHttp.listDocuments(storeName, {
          pageSize: 20,
          pageToken: docPageToken,
        }),
        RETRY_CONFIG.MAX_RETRIES,
        RETRY_CONFIG.RATE_LIMIT_DELAY_MS
      );

      // Collect document names (don't delete yet)
      for (const doc of docListResult.documents) {
        allDocumentNames.push(doc.name);
      }

      // If we got 0 documents but still have a nextPageToken, something is wrong - break
      if (docListResult.documents.length === 0 && docListResult.nextPageToken) {
        log.warn({ storeName, pageToken: docListResult.nextPageToken }, 'Got empty result with nextPageToken, stopping pagination');
        break;
      }

      // Break if no nextPageToken or if it's an empty string
      if (!docListResult.nextPageToken || docListResult.nextPageToken.trim() === '') {
        break;
      }

      docPageToken = docListResult.nextPageToken;
      docPageCount++;
    }

    log.info({ storeName, documentCount: allDocumentNames.length }, 'Collected all document names, starting deletion');

    // SECOND: Delete all collected documents
    for (const docName of allDocumentNames) {
      try {
        await retryWithBackoff(
          () => geminiHttp.deleteDocument(docName),
          RETRY_CONFIG.MAX_RETRIES,
          RETRY_CONFIG.RATE_LIMIT_DELAY_MS
        );
        result.documentsDeleted++;

        if (result.documentsDeleted % 10 === 0) {
          log.debug({ storeName, deleted: result.documentsDeleted, total: allDocumentNames.length }, 'Documents deleted');
        }

        // Small delay between document deletions to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (docError) {
        const message = docError instanceof Error ? docError.message : 'Unknown error';
        log.warn({ storeName, documentName: docName, error: message }, 'Failed to delete document after retries');
        result.errors.push({
          document: docName,
          error: message,
        });
      }
    }

    log.info({ storeName, documentsDeleted: result.documentsDeleted }, 'Store documents cleaned');

    // Delete store if requested
    if (deleteStore) {
      try {
        await retryWithBackoff(
          () => geminiHttp.deleteFileSearchStore(storeName),
          RETRY_CONFIG.MAX_RETRIES,
          RETRY_CONFIG.RATE_LIMIT_DELAY_MS
        );
        result.storeDeleted = true;
        log.info({ storeName }, 'Store deleted');
      } catch (storeError) {
        const message = storeError instanceof Error ? storeError.message : 'Unknown error';
        log.error({ storeName, error: message }, 'Failed to delete store after retries');
        result.errors.push({
          error: message,
        });
      }
    }

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ storeName, error: message }, 'Failed to clean store');
    throw new Error(`Failed to cleanup store: ${message}`);
  }
}

