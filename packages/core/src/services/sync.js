/**
 * Sync service
 * Handles incremental updates and refresh of website content
 */
import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as gemini from '../clients/gemini.js';
import * as indexingService from './indexing.js';
import { computeContentHash, hasContentChanged } from '../utils/hash.js';
import { extractPath, normalizeUrl, filterUrlsByDomain } from '../utils/url.js';
import { config } from '../config.js';
import { loggers } from '../utils/logger.js';
const log = loggers.sync;
/**
 * Perform incremental sync for a website
 *
 * Flow (Phase 1: Categorization):
 * 1. Re-run FireCrawl /map to get current URLs
 * 2. Compare with Supabase to categorize:
 *    - NEW: URL in map but not in DB → scrape + index
 *    - EXISTING: URL in both → scrape and compare hash
 *      - CHANGED: Hash differs → delete old, upload new, update DB
 *      - UNCHANGED: Hash matches → update timestamps, reset missing_count
 *    - MISSING: URL in DB but not in map → increment missing_count
 *    - 404/410: URL returns error → increment missing_count (treat as missing)
 *
 * Flow (Phase 2: Deletion):
 * 3. Only delete URLs where missing_count >= threshold (default: 3)
 *    This prevents false deletions due to temporary issues (site down, network errors, etc.)
 */
export async function syncWebsite(websiteId) {
    log.info({ websiteId }, 'Starting website sync');
    const website = await supabase.getWebsiteById(websiteId);
    if (!website) {
        throw new Error('Website not found');
    }
    // Verify website has been ingested (has at least one page)
    const existingPages = await supabase.getPagesByWebsite(websiteId);
    if (existingPages.length === 0) {
        throw new Error('Website has no pages. Use ingestion pipeline to register website first.');
    }
    if (!website.gemini_store_id) {
        throw new Error('Website has no Gemini store. This should not happen - store should be created during ingestion.');
    }
    // Create sync process job
    const syncJob = await supabase.createProcessJob({
        website_id: websiteId,
        process_type: 'sync',
        status: 'running',
    });
    const errors = [];
    const firecrawlBatchIds = []; // Track all batch IDs used
    let urlsDiscovered = 0;
    let urlsUpdated = 0;
    let urlsDeleted = 0;
    const now = new Date().toISOString(); // Define once at start
    try {
        // Step 0: Retry failed/processing/pending items from previous syncs (Self-Healing)
        // This handles incomplete pages from failed ingestion (missing markdown, no hash, etc.)
        log.info({ websiteId }, 'Checking for incomplete items to retry');
        const retryPages = await supabase.getPagesByStatuses(websiteId, ['pending', 'processing', 'error']);
        if (retryPages.length > 0) {
            log.info({
                count: retryPages.length,
                pending: retryPages.filter(p => p.status === 'pending').length,
                processing: retryPages.filter(p => p.status === 'processing').length,
                error: retryPages.filter(p => p.status === 'error').length
            }, 'Found incomplete items to retry');
            // Separate pages: those with markdown (handled by indexing) vs those needing re-scrape
            const pagesWithMarkdown = retryPages.filter((p) => p.markdown_content && p.content_hash);
            const pagesToReScrape = retryPages.filter((p) => !p.markdown_content || !p.content_hash);
            // Ensure pages with markdown have status='processing' for indexing pipeline
            for (const page of pagesWithMarkdown) {
                if (page.status !== 'processing') {
                    await supabase.updatePage(page.id, {
                        status: 'processing',
                        error_message: null,
                    });
                }
            }
            // Batch scrape pages that need re-scraping
            if (pagesToReScrape.length > 0) {
                const retryUrls = pagesToReScrape.map((p) => p.url);
                const batchStart = await firecrawl.batchScrapeStart(retryUrls);
                if (batchStart.success) {
                    const batchJobId = batchStart.jobId;
                    firecrawlBatchIds.push(batchJobId);
                    log.info({ batchJobId, urlCount: retryUrls.length }, 'Batch scrape started for retry URLs');
                    const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
                        pollIntervalMs: 5000,
                        maxWaitMs: 600000, // 10 minutes
                    });
                    if (scrapeResult.success && scrapeResult.data) {
                        const retryPageMap = new Map(pagesToReScrape.map((p) => [p.url, p]));
                        for (const pageData of scrapeResult.data) {
                            if (!pageData)
                                continue;
                            const url = pageData.metadata?.sourceURL;
                            if (!url)
                                continue;
                            const page = retryPageMap.get(url);
                            if (!page)
                                continue;
                            // Validate completeness
                            if (!pageData.markdown || pageData.markdown.trim().length === 0) {
                                log.warn({ url }, 'Empty markdown content, skipping (discarded)');
                                errors.push({ url, error: 'Empty content after scraping', timestamp: now });
                                continue;
                            }
                            // Write complete scrape to DB with status='ready_for_indexing'
                            try {
                                const contentHash = computeContentHash(pageData.markdown);
                                await supabase.updatePage(page.id, {
                                    status: 'ready_for_indexing', // Page scraped, markdown stored, ready for indexing service to pick up
                                    content_hash: contentHash,
                                    markdown_content: pageData.markdown,
                                    title: pageData.metadata.title,
                                    http_status_code: pageData.metadata.statusCode,
                                    firecrawl_scrape_count: (page.firecrawl_scrape_count ?? 0) + 1,
                                    last_seen: now,
                                    error_message: null,
                                    metadata: {
                                        title: pageData.metadata.title,
                                        description: pageData.metadata.description,
                                        og_image: pageData.metadata.ogImage,
                                        language: pageData.metadata.language,
                                    },
                                    firecrawl_batch_id: batchJobId,
                                    last_updated_by_sync_id: syncJob.id,
                                });
                                urlsUpdated++;
                            }
                            catch (dbError) {
                                const message = dbError instanceof Error ? dbError.message : 'Unknown error';
                                log.error({ url, error: message }, 'Failed to update page');
                                errors.push({ url, error: message, timestamp: now });
                            }
                        }
                    }
                    else {
                        log.error({ error: scrapeResult.error }, 'Batch scrape failed for retry URLs');
                    }
                }
                else {
                    log.error({ error: batchStart.error }, 'Failed to start batch scrape for retry URLs');
                }
            }
            // Note: Pages with markdown_content will be handled by indexing pipeline
        }
        // Step 1: Discover current URLs
        log.info({ seedUrl: website.seed_url }, 'Mapping website');
        const mapResult = await firecrawl.mapWebsite(website.seed_url);
        if (!mapResult.success) {
            throw new Error(`Failed to map website: ${mapResult.error}`);
        }
        // Filter and normalize URLs
        const currentUrls = [...new Set(filterUrlsByDomain(mapResult.links, website.domain).map(normalizeUrl))];
        log.info({ urlCount: currentUrls.length }, 'Current URLs discovered');
        // Step 2: Get existing pages from Supabase
        const existingPages = await supabase.getPagesByWebsite(websiteId);
        const existingUrlSet = new Set(existingPages.map((p) => p.url));
        // Map for quick lookup by URL
        const existingPageMap = new Map(existingPages.map((p) => [p.url, p]));
        // Phase 1: Categorization (The "Diff")
        // Compare FireCrawl map results with database to categorize URLs
        // Note: Pages with status 'pending', 'processing', or 'error' are handled in retry logic above
        // They are still considered "existing" for categorization purposes
        const newUrls = currentUrls.filter((url) => !existingUrlSet.has(url));
        const existingUrls = currentUrls.filter((url) => existingUrlSet.has(url));
        const missingUrls = existingPages
            .filter((p) => p.status !== 'deleted' && !currentUrls.includes(p.url))
            .map((p) => p.url);
        // Log status breakdown for existing URLs
        const existingPagesStatusBreakdown = existingUrls
            .map(url => existingPageMap.get(url))
            .filter((p) => p !== undefined)
            .reduce((acc, p) => {
            acc[p.status] = (acc[p.status] || 0) + 1;
            return acc;
        }, {});
        log.debug({ statusBreakdown: existingPagesStatusBreakdown }, 'Existing URLs status breakdown');
        log.info({ newUrls: newUrls.length, existing: existingUrls.length, missing: missingUrls.length }, 'Phase 1: URL categorization complete');
        urlsDiscovered = newUrls.length;
        // Step 3: Handle new URLs
        if (newUrls.length > 0) {
            log.info({ count: newUrls.length }, 'Processing new URLs');
            // Start batch scrape for new URLs (don't write to DB yet - only write complete scrapes)
            const batchStart = await firecrawl.batchScrapeStart(newUrls);
            if (!batchStart.success) {
                log.error({ error: batchStart.error }, 'Failed to start batch scrape for new URLs');
                errors.push(...newUrls.map(url => ({ url, error: batchStart.error || 'Batch scrape start failed', timestamp: now })));
            }
            else {
                const batchJobId = batchStart.jobId;
                firecrawlBatchIds.push(batchJobId);
                log.info({ batchJobId, urlCount: newUrls.length }, 'Batch scrape started for new URLs');
                // Wait for batch scrape to complete
                const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
                    pollIntervalMs: 5000,
                    maxWaitMs: 600000, // 10 minutes
                });
                if (scrapeResult.success && scrapeResult.data) {
                    for (const pageData of scrapeResult.data) {
                        if (!pageData)
                            continue;
                        const url = pageData.metadata?.sourceURL;
                        // Validate completeness - skip if missing required data
                        if (!url) {
                            log.warn({ pageData }, 'Page missing sourceURL, skipping (discarded)');
                            continue; // Discard - don't write to DB
                        }
                        // ========================================================================
                        // VALIDATION PHASE: Ensure we have ALL required data before writing
                        // ========================================================================
                        if (!pageData.markdown || typeof pageData.markdown !== 'string') {
                            log.warn({ url }, 'Page missing markdown or invalid type, skipping (discarded)');
                            errors.push({ url, error: 'Missing or invalid markdown content', timestamp: now });
                            continue; // Discard - don't write to DB
                        }
                        const trimmedMarkdown = pageData.markdown.trim();
                        if (trimmedMarkdown.length === 0) {
                            log.warn({ url }, 'Empty markdown content after trim, skipping (discarded)');
                            errors.push({ url, error: 'Empty content after scraping', timestamp: now });
                            continue; // Discard - don't write to DB
                        }
                        // ========================================================================
                        // DATA PREPARATION: Prepare all data for single atomic write
                        // ========================================================================
                        const contentHash = computeContentHash(pageData.markdown);
                        const path = extractPath(url);
                        const httpStatusCode = pageData.metadata?.statusCode ?? null;
                        // ========================================================================
                        // SINGLE ATOMIC WRITE: Write complete data in one operation
                        // ========================================================================
                        // Only call upsertPage when we have ALL required data ready
                        // No verification needed - if validation passed, write will succeed with complete data
                        try {
                            await supabase.upsertPage({
                                website_id: websiteId,
                                url,
                                path,
                                title: pageData.metadata?.title,
                                status: 'processing', // Not 'active' yet - indexing will promote it
                                content_hash: contentHash,
                                markdown_content: pageData.markdown, // Complete markdown content
                                http_status_code: httpStatusCode,
                                firecrawl_scrape_count: 1,
                                last_seen: now,
                                metadata: {
                                    title: pageData.metadata?.title,
                                    description: pageData.metadata?.description,
                                    og_image: pageData.metadata?.ogImage,
                                    language: pageData.metadata?.language,
                                },
                                created_by_sync_id: syncJob.id,
                                firecrawl_batch_id: batchJobId,
                            });
                            urlsUpdated++;
                        }
                        catch (dbError) {
                            const message = dbError instanceof Error ? dbError.message : 'Unknown error';
                            log.error({ url, error: message }, 'Failed to write page to DB');
                            errors.push({ url, error: message, timestamp: now });
                            // Continue - don't fail entire process for one URL
                        }
                    }
                }
                else {
                    log.error({ error: scrapeResult.error }, 'Batch scrape failed for new URLs');
                }
            }
        }
        // Step 4: Handle existing URLs - check for changes via hash comparison
        // This is the robust comparison: scrape existing URLs and compare hashes
        if (existingUrls.length > 0) {
            log.info({ count: existingUrls.length }, 'Checking existing URLs for changes');
            // Get existing pages that are active (need to check)
            const existingPagesToCheck = existingUrls
                .map((url) => existingPageMap.get(url))
                .filter((p) => p !== undefined && p.status === 'active');
            if (existingPagesToCheck.length > 0) {
                // Batch scrape existing URLs to get current content
                const existingUrlsToScrape = existingPagesToCheck.map((p) => p.url);
                const batchStart = await firecrawl.batchScrapeStart(existingUrlsToScrape);
                if (!batchStart.success) {
                    log.error({ error: batchStart.error }, 'Failed to start batch scrape for existing URLs');
                    errors.push(...existingUrlsToScrape.map(url => ({ url, error: batchStart.error || 'Batch scrape start failed', timestamp: now })));
                }
                else {
                    const batchJobId = batchStart.jobId;
                    firecrawlBatchIds.push(batchJobId);
                    log.info({ batchJobId, urlCount: existingUrlsToScrape.length }, 'Batch scrape started for existing URLs');
                    const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
                        pollIntervalMs: 5000,
                        maxWaitMs: 600000, // 10 minutes
                    });
                    if (scrapeResult.success && scrapeResult.data) {
                        for (const pageData of scrapeResult.data) {
                            if (!pageData)
                                continue;
                            const url = pageData.metadata.sourceURL;
                            if (!url)
                                continue;
                            const page = existingPageMap.get(url);
                            if (!page || page.status !== 'active')
                                continue;
                            try {
                                // Handle 404/410 - increment missing_count (don't delete immediately)
                                // This could be temporary, so we use threshold-based deletion
                                const statusCode = pageData.metadata.statusCode;
                                if (statusCode === 404 || statusCode === 410) {
                                    log.info({ url, statusCode }, 'URL returned 404/410, incrementing missing_count');
                                    // Increment missing_count instead of immediate deletion
                                    // This will be handled by the threshold-based deletion logic later
                                    await supabase.incrementMissingCount(websiteId, [url]);
                                    continue;
                                }
                                // Skip if empty content (but URL exists, so reset missing_count)
                                if (!pageData.markdown || pageData.markdown.trim().length === 0) {
                                    // URL exists but empty - reset missing_count, update last_seen
                                    await supabase.updatePage(page.id, {
                                        last_seen: now,
                                        missing_count: 0,
                                    });
                                    continue;
                                }
                                // Compare hash to detect changes
                                const { changed, newHash } = hasContentChanged(pageData.markdown, page.content_hash);
                                if (!changed) {
                                    // UNCHANGED: Just update timestamps and increment scrape count
                                    await supabase.updatePage(page.id, {
                                        last_scraped: now,
                                        last_seen: now,
                                        firecrawl_scrape_count: (page.firecrawl_scrape_count ?? 0) + 1,
                                        http_status_code: pageData.metadata.statusCode,
                                    });
                                    continue;
                                }
                                // CHANGED: Content hash differs - update DB with new content
                                log.debug({ url }, 'Content changed, updating');
                                // Delete old document from Gemini (if exists) - indexing will upload new one
                                if (page.gemini_file_id) {
                                    try {
                                        await gemini.deleteFileFromStore(website.gemini_store_id, page.gemini_file_id);
                                    }
                                    catch (error) {
                                        // Ignore 404 - document may already be gone
                                        log.warn({ url, error }, 'Failed to delete old document (may already be gone)');
                                    }
                                }
                                // Save new markdown and hash, set status to 'processing'
                                // Indexing pipeline will upload to Gemini and set to 'active'
                                await supabase.updatePage(page.id, {
                                    status: 'processing',
                                    title: pageData.metadata.title,
                                    content_hash: newHash,
                                    markdown_content: pageData.markdown,
                                    http_status_code: pageData.metadata.statusCode,
                                    firecrawl_scrape_count: (page.firecrawl_scrape_count ?? 0) + 1,
                                    last_seen: now,
                                    gemini_file_id: undefined, // Clear old file ID - indexing will set new one
                                    gemini_file_name: undefined,
                                    error_message: null,
                                    metadata: {
                                        title: pageData.metadata.title,
                                        description: pageData.metadata.description,
                                        og_image: pageData.metadata.ogImage,
                                        language: pageData.metadata.language,
                                    },
                                    firecrawl_batch_id: batchJobId, // Track batch job
                                    last_updated_by_sync_id: syncJob.id,
                                });
                                urlsUpdated++;
                            }
                            catch (pageError) {
                                const message = pageError instanceof Error ? pageError.message : 'Unknown error';
                                errors.push({ url, error: message, timestamp: now });
                                log.error({ url, error: message }, 'Failed to process existing URL');
                            }
                        }
                    }
                    else {
                        log.error({ error: scrapeResult.error }, 'Batch scrape failed for existing URLs');
                    }
                }
            }
            // Update last_seen for all existing URLs (even if we didn't check them)
            await supabase.updatePagesLastSeen(websiteId, existingUrls, now);
        }
        // Step 5: Handle missing URLs (increment missing_count)
        // These are URLs that exist in DB but not found in FireCrawl map
        // This could be temporary (site down, network issue, etc.), so we use threshold-based deletion
        if (missingUrls.length > 0) {
            log.info({ count: missingUrls.length }, 'URLs missing from map, incrementing missing_count');
            await supabase.incrementMissingCount(websiteId, missingUrls);
        }
        // Step 6: Handle deletions (URLs past threshold)
        // Only delete URLs that have been missing for >= threshold consecutive syncs
        // This prevents false deletions due to temporary issues
        const threshold = config.sync.deletionThreshold;
        const pagesToDelete = await supabase.getPagesPastDeletionThreshold(websiteId, threshold);
        if (pagesToDelete.length > 0) {
            log.info({ count: pagesToDelete.length, threshold }, 'Pages past deletion threshold, marking as deleted');
            for (const page of pagesToDelete) {
                try {
                    if (page.gemini_file_id) {
                        await gemini.deleteFileFromStore(website.gemini_store_id, page.gemini_file_id);
                    }
                }
                catch (error) {
                    log.warn({ pageId: page.id, error }, 'Failed to delete from Gemini');
                }
            }
            await supabase.markPagesDeleted(pagesToDelete.map((p) => p.id));
            urlsDeleted = pagesToDelete.length;
        }
        // Step 7: Update sync process job
        await supabase.updateProcessJob(syncJob.id, {
            completed_at: now,
            urls_discovered: urlsDiscovered,
            urls_updated: urlsUpdated, // Pages written to DB (status='processing')
            urls_deleted: urlsDeleted,
            urls_errored: errors.length,
            firecrawl_batch_ids: firecrawlBatchIds,
            errors,
            status: 'completed',
        });
        // Step 8: Update website
        await supabase.updateWebsite(websiteId, {
            last_full_crawl: now,
        });
        log.info({ websiteId, urlsDiscovered, urlsUpdated, urlsDeleted, errors: errors.length }, 'Sync scraping phase complete - triggering indexing');
        // Step 9: Trigger indexing pipeline (separate process - fire and forget)
        // This will pick up pages with status='ready_for_indexing' and upload to Gemini
        // We don't await this - sync completes independently, indexing runs in background
        log.info({ websiteId, syncJobId: syncJob.id }, 'Triggering indexing pipeline (async)');
        // Fire and forget - indexing runs independently
        // Pass syncJobId (not ingestionJobId) for clear lineage tracking
        indexingService.indexWebsite(websiteId, {
            syncJobId: syncJob.id, // Pass sync job ID for correct lineage
        }).then((indexingResult) => {
            log.info({
                websiteId,
                pagesIndexed: indexingResult.pagesIndexed,
                indexingErrors: indexingResult.errors.length,
            }, 'Indexing pipeline complete (background)');
        }).catch((indexingError) => {
            // Don't fail sync if indexing fails - it can be retried later
            log.error({ websiteId, error: indexingError }, 'Indexing pipeline failed (can be retried later)');
        });
        return {
            syncLogId: syncJob.id, // Keep for backward compatibility, but it's actually processJobId now
            urlsDiscovered,
            urlsUpdated,
            urlsDeleted,
            urlsErrored: errors.length,
            errors,
        };
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        await supabase.updateProcessJob(syncJob.id, {
            completed_at: new Date().toISOString(),
            errors: [...errors, { url: website.seed_url, error: message, timestamp: new Date().toISOString() }],
            status: 'failed',
        });
        log.error({ websiteId, error: message }, 'Sync failed');
        throw error;
    }
}
/**
 * Get sync history for a website
 */
export async function getSyncHistory(websiteId, limit = 10) {
    // Get process jobs of type 'sync' for this website
    const jobs = await supabase.getProcessJobs(websiteId, {
        processType: 'sync',
        limit,
    });
    return jobs.map((job) => ({
        id: job.id,
        type: job.process_type,
        status: job.status,
        startedAt: job.started_at,
        completedAt: job.completed_at,
        urlsDiscovered: job.urls_discovered,
        urlsUpdated: job.urls_updated,
        urlsDeleted: job.urls_deleted,
        errorCount: job.urls_errored,
    }));
}
//# sourceMappingURL=sync.js.map