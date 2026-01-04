/**
 * Indexing service
 * Handles uploading stored markdown content to Gemini File Search
 * This is separate from ingestion (scraping) to allow retries without re-scraping
 */
import * as supabase from '../clients/supabase.js';
import * as geminiHttp from '../clients/gemini-http.js';
import { extractPath } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
const log = loggers.ingestion; // Reuse ingestion logger for now
/**
 * Index a website by uploading all stored markdown to Gemini File Search
 *
 * This should be called after ingestion completes (after markdown is stored).
 * Can be retried independently if indexing fails.
 *
 * @param websiteId - The website to index
 * @param ingestionJobId - Optional: Link to the ingestion job that scraped the content
 * @param autoCreateStore - If true, create Gemini store if it doesn't exist (default: true)
 */
export async function indexWebsite(websiteId, options) {
    const { ingestionJobId, syncJobId, autoCreateStore = true } = options ?? {};
    const errors = [];
    // Determine which job triggered this indexing for clear lineage
    const parentJobId = syncJobId || ingestionJobId;
    const parentJobType = syncJobId ? 'sync' : 'ingestion';
    log.info({ websiteId, ingestionJobId, syncJobId, parentJobType }, 'Starting website indexing');
    // Get website
    const website = await supabase.getWebsiteById(websiteId);
    if (!website) {
        throw new Error('Website not found');
    }
    // Create indexing process job
    // Metadata will track Gemini document states (ACTIVE/PROCESSING/FAILED) since indexing is asynchronous
    // Store the correct parent job ID based on what triggered indexing (sync vs ingestion)
    const indexingJob = await supabase.createProcessJob({
        website_id: websiteId,
        process_type: 'indexing',
        status: 'running',
        metadata: {
            ...(syncJobId ? { syncJobId } : {}),
            ...(ingestionJobId ? { ingestionJobId } : {}),
            documentStates: {}, // Will be populated as we process pages
        },
    });
    try {
        // Step 1: Ensure Gemini store exists
        let geminiStoreId = website.gemini_store_id;
        if (!geminiStoreId) {
            if (autoCreateStore) {
                log.info({ websiteId }, 'Creating Gemini File Search store');
                const storeName = `website-${website.domain.replace(/\./g, '-')}-${Date.now()}`;
                const geminiStore = await geminiHttp.createFileSearchStore(storeName);
                geminiStoreId = geminiStore.name;
                // Update website with store ID
                await supabase.updateWebsite(websiteId, {
                    gemini_store_id: geminiStore.name,
                    gemini_store_name: geminiStore.displayName,
                });
            }
            else {
                throw new Error('Website has no Gemini store and autoCreateStore is false');
            }
        }
        // Step 2: Get pages ready for indexing
        // These are pages that ingestion/sync has scraped and marked as "ready for indexing"
        // Criteria: status='ready_for_indexing' + markdown_content exists + no gemini_file_id yet
        // Optionally filter by process job (ingestion or sync)
        // Limit to 200 pages per run to manage memory and allow incremental progress
        const pagesToIndex = await supabase.getPagesReadyForIndexing(websiteId, {
            processJobId: parentJobId, // Use the parent job ID (sync or ingestion)
            limit: 200, // Process 200 pages at a time
        });
        log.info({
            websiteId,
            pagesToIndex: pagesToIndex.length
        }, 'Pages to index');
        if (pagesToIndex.length === 0) {
            log.info({ websiteId }, 'No pages to index');
            await supabase.updateProcessJob(indexingJob.id, {
                status: 'completed',
                urls_updated: 0,
                completed_at: new Date().toISOString(),
            });
            return {
                indexingJobId: indexingJob.id,
                websiteId,
                pagesIndexed: 0,
                errors: [],
            };
        }
        // Step 3: Upload pages to Gemini using batch processing
        const now = new Date().toISOString();
        // Prepare batch upload items
        const batchItems = pagesToIndex
            .filter(page => page.markdown_content)
            .map(page => ({
            id: page.id,
            content: page.markdown_content,
            metadata: {
                url: page.url,
                title: page.title ?? page.url,
                path: page.path ?? extractPath(page.url),
                lastUpdated: now,
            },
        }));
        if (batchItems.length === 0) {
            log.info({ websiteId }, 'No pages with content to index');
            await supabase.updateProcessJob(indexingJob.id, {
                status: 'completed',
                urls_updated: 0,
                completed_at: new Date().toISOString(),
            });
            return {
                indexingJobId: indexingJob.id,
                websiteId,
                pagesIndexed: 0,
                errors: [],
            };
        }
        // Upload in batches with progress tracking and incremental database updates
        // Note: This is NOT a single batch API call - it's 5 parallel individual upload calls
        // Each upload is a separate API call to the upload endpoint, processed concurrently
        // There is no batch upload endpoint in the Gemini API - we simulate batching via concurrency
        // 
        // IMPORTANT: We update database after EACH batch of 5 uploads completes
        // This ensures progress is saved incrementally, not all at once at the end
        log.info({ websiteId, totalPages: batchItems.length, batchSize: geminiHttp.BATCH_CONFIG.BATCH_SIZE }, 'Starting batch upload to Gemini (5 parallel API calls per batch, updating DB after each batch)');
        // Step 4: Process in batches and update database incrementally
        let pagesIndexed = 0;
        const pageMap = new Map(pagesToIndex.map(page => [page.id, page]));
        const uploadBatchSize = geminiHttp.BATCH_CONFIG.BATCH_SIZE; // 5
        // Track document states in process job metadata (for debugging/monitoring)
        // Since indexing is asynchronous, we track states in process_jobs, not pages table
        const documentStates = {};
        // Process uploads in batches of 5, updating database after each batch
        for (let i = 0; i < batchItems.length; i += uploadBatchSize) {
            const batch = batchItems.slice(i, i + uploadBatchSize);
            const batchNumber = Math.floor(i / uploadBatchSize) + 1;
            const totalBatches = Math.ceil(batchItems.length / uploadBatchSize);
            log.info({ batchNumber, totalBatches, batchItems: batch.length }, 'Processing upload batch');
            // Upload this batch of 5 in parallel
            const batchPromises = batch.map(async (item) => {
                try {
                    const result = await geminiHttp.uploadToFileSearchStore(geminiStoreId, item.content, item.metadata);
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
                        await new Promise(resolve => setTimeout(resolve, geminiHttp.BATCH_CONFIG.RATE_LIMIT_BACKOFF_MS));
                        try {
                            const retryResult = await geminiHttp.uploadToFileSearchStore(geminiStoreId, item.content, item.metadata);
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
            // Wait for this batch of 5 to complete
            const batchResults = await Promise.all(batchPromises);
            // Update database immediately after this batch completes
            for (const result of batchResults) {
                const page = pageMap.get(result.id);
                if (!page)
                    continue;
                if (result.success && result.result) {
                    // Verify actual document state from Gemini API
                    // According to API docs: https://ai.google.dev/api/file-search/documents#endpoint
                    // States: STATE_PENDING (processing), STATE_ACTIVE (ready), STATE_FAILED (error)
                    // We ONLY mark as 'active' when state is ACTIVE (completely done)
                    // PENDING or FAILED → keep as 'ready_for_indexing' so it gets picked up in next indexing run
                    // IMPORTANT: Delete the uploaded file if not ACTIVE to avoid duplication on retry
                    let actualDocumentState = 'PROCESSING';
                    let finalStatus = 'ready_for_indexing';
                    let shouldDeleteDocument = false;
                    try {
                        // Check actual document state from Gemini API
                        // API returns: "PENDING", "ACTIVE", or "FAILED" (enum State)
                        const document = await geminiHttp.getDocument(result.result.name);
                        const geminiState = document.state?.toUpperCase();
                        if (geminiState === 'ACTIVE' || geminiState === 'STATE_ACTIVE') {
                            // Document is fully processed and ready for querying
                            actualDocumentState = 'ACTIVE';
                            finalStatus = 'active';
                            shouldDeleteDocument = false; // Keep it - it's active!
                        }
                        else if (geminiState === 'FAILED' || geminiState === 'STATE_FAILED') {
                            // Document processing failed - delete it and retry
                            actualDocumentState = 'FAILED';
                            finalStatus = 'ready_for_indexing'; // Back to ready for indexing so it can be retried
                            shouldDeleteDocument = true; // Delete failed document to avoid duplication
                        }
                        else {
                            // PENDING, STATE_PENDING, or unknown - still processing embeddings
                            // Delete it and retry (we'll upload fresh on next run)
                            actualDocumentState = 'PROCESSING';
                            finalStatus = 'ready_for_indexing'; // Back to ready for indexing so it can be retried
                            shouldDeleteDocument = true; // Delete pending document to avoid duplication
                        }
                    }
                    catch (docError) {
                        // If we can't verify document state, assume PENDING (conservative approach)
                        // This ensures we don't mark as active prematurely
                        log.warn({ url: page.url, documentName: result.result.name, error: docError }, 'Could not verify document state, deleting and will retry next run');
                        // Don't trust upload result state - always verify
                        // If verification fails, delete and retry
                        actualDocumentState = 'PROCESSING';
                        finalStatus = 'ready_for_indexing';
                        shouldDeleteDocument = true; // Delete since we can't verify state
                    }
                    // Delete document from Gemini if it didn't complete successfully
                    // This prevents duplication when we retry indexing
                    if (shouldDeleteDocument) {
                        try {
                            log.info({ url: page.url, documentName: result.result.name, state: actualDocumentState }, 'Deleting incomplete document from Gemini to avoid duplication on retry');
                            await geminiHttp.deleteDocument(result.result.name);
                        }
                        catch (deleteError) {
                            // Log but don't fail - document might already be deleted or not exist
                            log.warn({ url: page.url, documentName: result.result.name, error: deleteError }, 'Failed to delete incomplete document (may already be deleted)');
                        }
                    }
                    // Track document state in process job metadata (for debugging/monitoring)
                    // Since indexing is asynchronous, we track states in process_jobs, not pages table
                    documentStates[page.id] = actualDocumentState;
                    // Update page with Gemini info
                    // CRITICAL: Only update to 'active' when document state is ACTIVE
                    // PENDING/FAILED → keep status='ready_for_indexing' so it gets picked up next run
                    // If document was deleted, clear gemini_file_id so it can be re-uploaded
                    const updateData = {
                        status: finalStatus,
                        last_scraped: new Date().toISOString(),
                        // Only clear error_message if document is ACTIVE
                        // For FAILED, set error message; for PENDING, leave undefined (not an error)
                        error_message: actualDocumentState === 'FAILED'
                            ? 'Document processing failed in Gemini, will retry'
                            : undefined,
                    };
                    // Only include gemini_file_id and gemini_file_name if document is ACTIVE
                    // Use undefined instead of null to match PageUpdate type (string | undefined)
                    if (finalStatus === 'active') {
                        updateData.gemini_file_id = result.result.name;
                        updateData.gemini_file_name = result.result.displayName ?? undefined;
                    }
                    await supabase.updatePage(page.id, updateData);
                    // Only count as indexed if document is actually ACTIVE and ready for querying
                    if (finalStatus === 'active') {
                        pagesIndexed++;
                    }
                    else {
                        // PENDING or FAILED - deleted from Gemini, will be picked up in next indexing run
                        log.debug({
                            url: page.url,
                            documentState: actualDocumentState,
                            note: 'Document uploaded but not active, deleted and will retry next run'
                        }, 'Document not yet active, deleted to avoid duplication');
                    }
                }
                else {
                    // Upload failed - keep status='ready_for_indexing' so it can be retried
                    const errorMessage = result.error || 'Unknown upload error';
                    log.error({ url: page.url, error: errorMessage }, 'Failed to upload page to Gemini');
                    errors.push({ url: page.url, error: errorMessage, timestamp: now });
                    // Keep status as 'ready_for_indexing' so it gets picked up in next indexing run
                    // Don't update gemini_file_id (should already be null)
                    await supabase.updatePage(page.id, {
                        error_message: errorMessage,
                        // Status remains 'ready_for_indexing' - will be retried
                    });
                }
            }
            // Log progress after each batch
            log.info({
                batchNumber,
                totalBatches,
                batchCompleted: batchResults.length,
                totalIndexed: pagesIndexed,
                totalProcessed: i + batch.length
            }, 'Batch completed and saved to database');
            // Brief pause between batches to avoid rate limits
            if (i + uploadBatchSize < batchItems.length) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        // Step 5: Update indexing job (after all batches processed)
        // Include document states in metadata for debugging/monitoring
        // Since indexing is asynchronous, we track Gemini document states here, not in pages table
        await supabase.updateProcessJob(indexingJob.id, {
            status: 'completed',
            urls_updated: pagesIndexed,
            urls_errored: errors.length,
            errors,
            completed_at: new Date().toISOString(),
            metadata: {
                ingestionJobId,
                documentStates, // Track ACTIVE/PROCESSING/FAILED states per page
                // Summary counts
                activeCount: Object.values(documentStates).filter(s => s === 'ACTIVE').length,
                processingCount: Object.values(documentStates).filter(s => s === 'PROCESSING').length,
                failedCount: Object.values(documentStates).filter(s => s === 'FAILED').length,
            },
        });
        log.info({
            indexingJobId: indexingJob.id,
            websiteId,
            pagesIndexed,
            errors: errors.length,
        }, 'Indexing complete');
        return {
            indexingJobId: indexingJob.id,
            websiteId,
            pagesIndexed,
            errors,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        // Update indexing job with failure
        await supabase.updateProcessJob(indexingJob.id, {
            status: 'failed',
            errors: [...errors, { url: website.seed_url, error: message, timestamp: new Date().toISOString() }],
            completed_at: new Date().toISOString(),
        });
        log.error({ indexingJobId: indexingJob.id, error: message }, 'Indexing failed');
        throw error;
    }
}
//# sourceMappingURL=indexing.js.map