/**
 * Individual URL service
 * Handles individual URL operations: indexing, status checking, and reindexing
 *
 * - Indexing: Add a single URL to an existing website (Service 5)
 * - Status: Get the current status of a URL
 * - Reindex: Force re-scrape and re-index an existing URL
 */
import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as gemini from '../clients/gemini.js';
import * as indexingService from './indexing.js';
import { computeContentHash, hasContentChanged } from '../utils/hash.js';
import { extractDomain, extractPath, normalizeUrl } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
const log = loggers.ingestion; // Reuse ingestion logger
/**
 * Index a single URL for an existing website
 *
 * @param websiteId - The website ID (must exist)
 * @param url - The URL to index
 * @returns Result with status
 */
export async function indexIndividualUrl(websiteId, url) {
    const normalizedUrl = normalizeUrl(url);
    const domain = extractDomain(normalizedUrl);
    log.info({ websiteId, url: normalizedUrl }, 'Starting individual URL indexing');
    // Step 1: Verify website exists
    const website = await supabase.getWebsiteById(websiteId);
    if (!website) {
        throw new Error('Website not found');
    }
    // Step 2: Verify URL is from same exact domain
    // Each domain/subdomain is separate - must match exactly
    if (domain !== website.domain) {
        throw new Error(`URL domain (${domain}) does not match website domain (${website.domain}). Each domain/subdomain is a separate website.`);
    }
    // Step 3: Verify website has existing pages (requirement: website must have pages)
    const existingPages = await supabase.getPagesByWebsite(websiteId);
    if (existingPages.length === 0) {
        throw new Error('Website has no existing pages. Use ingestion pipeline instead.');
    }
    log.info({ websiteId, domain, existingPagesCount: existingPages.length }, 'Website verified - has existing pages');
    // Step 4: Scrape URL using direct scrape (not batch)
    log.info({ url: normalizedUrl }, 'Scraping individual URL');
    const scrapeResult = await firecrawl.scrapeUrl(normalizedUrl);
    if (!scrapeResult.success || !scrapeResult.data) {
        const error = scrapeResult.error || 'Scrape failed';
        log.error({ url: normalizedUrl, error }, 'Failed to scrape URL');
        return {
            success: false,
            websiteId,
            url: normalizedUrl,
            status: 'error',
            error,
        };
    }
    // Step 5: Validate completeness
    if (!scrapeResult.data.markdown || scrapeResult.data.markdown.trim().length === 0) {
        const error = 'Empty content after scraping';
        log.warn({ url: normalizedUrl }, error);
        return {
            success: false,
            websiteId,
            url: normalizedUrl,
            status: 'error',
            error,
        };
    }
    // Step 6: Write to DB with status='processing'
    const now = new Date().toISOString();
    const contentHash = computeContentHash(scrapeResult.data.markdown);
    try {
        const page = await supabase.upsertPage({
            website_id: websiteId,
            url: normalizedUrl,
            path: extractPath(normalizedUrl),
            title: scrapeResult.data.metadata.title,
            status: 'processing', // Not 'active' yet - indexing will promote it
            content_hash: contentHash,
            metadata: {
                title: scrapeResult.data.metadata.title,
                description: scrapeResult.data.metadata.description,
                og_image: scrapeResult.data.metadata.ogImage,
                language: scrapeResult.data.metadata.language,
            },
        });
        // Update with additional fields
        await supabase.updatePage(page.id, {
            markdown_content: scrapeResult.data.markdown,
            http_status_code: scrapeResult.data.metadata.statusCode,
            firecrawl_scrape_count: 1,
            last_seen: now,
            error_message: null,
        });
        log.info({ url: normalizedUrl }, 'URL written to DB (status=processing) - triggering indexing');
        // Step 7: Trigger indexing pipeline (will upload to Gemini and set to 'active')
        try {
            await indexingService.indexWebsite(websiteId, {
            // No specific process job ID - will index all 'processing' pages for this website
            });
            // Check if page is now active
            const updatedPage = await supabase.getPageByUrl(normalizedUrl);
            if (updatedPage?.status === 'active') {
                return {
                    success: true,
                    websiteId,
                    url: normalizedUrl,
                    status: 'active',
                };
            }
            else {
                return {
                    success: true,
                    websiteId,
                    url: normalizedUrl,
                    status: 'processing', // Still processing - indexing may be in progress
                };
            }
        }
        catch (indexingError) {
            // Don't fail - page is written, indexing can be retried
            log.error({ websiteId, url: normalizedUrl, error: indexingError }, 'Indexing pipeline failed (can be retried later)');
            return {
                success: true,
                websiteId,
                url: normalizedUrl,
                status: 'processing', // Written but indexing pending
            };
        }
    }
    catch (dbError) {
        const message = dbError instanceof Error ? dbError.message : 'Unknown error';
        log.error({ url: normalizedUrl, error: message }, 'Failed to write URL to DB');
        return {
            success: false,
            websiteId,
            url: normalizedUrl,
            status: 'error',
            error: message,
        };
    }
}
/**
 * Get the current status of a URL
 */
export async function getUrlStatus(url) {
    const normalizedUrl = normalizeUrl(url);
    log.debug({ url: normalizedUrl }, 'Getting URL status');
    const page = await supabase.getPageByUrl(normalizedUrl);
    if (!page) {
        return {
            url: normalizedUrl,
            status: 'pending',
            lastScraped: null,
            lastSeen: null,
            contentHash: null,
            error: null,
            found: false,
        };
    }
    return {
        url: page.url,
        status: page.status,
        lastScraped: page.last_scraped,
        lastSeen: page.last_seen,
        contentHash: page.content_hash,
        error: page.error_message,
        found: true,
    };
}
/**
 * Force re-scrape and re-index a specific URL
 */
export async function reindexUrl(url) {
    const normalizedUrl = normalizeUrl(url);
    log.info({ url: normalizedUrl }, 'Reindexing URL');
    // Get existing page record
    const page = await supabase.getPageByUrl(normalizedUrl);
    if (!page) {
        throw new Error(`URL not found in index: ${normalizedUrl}`);
    }
    // Get website for Gemini store reference
    const website = await supabase.getWebsiteById(page.website_id);
    if (!website || !website.gemini_store_id) {
        throw new Error('Website or Gemini store not found');
    }
    // Scrape the URL
    const scrapeResult = await firecrawl.scrapeUrl(normalizedUrl);
    if (!scrapeResult.success || !scrapeResult.data) {
        const error = scrapeResult.error ?? 'Scrape failed';
        log.error({ url: normalizedUrl, error }, 'Reindex scrape failed');
        await supabase.updatePage(page.id, {
            status: 'error',
            error_message: error,
        });
        return {
            success: false,
            url: normalizedUrl,
            contentChanged: false,
            previousHash: page.content_hash,
            newHash: '',
            message: `Scrape failed: ${error}`,
        };
    }
    const content = scrapeResult.data.markdown;
    const now = new Date().toISOString();
    // Check if content changed
    const { changed, newHash } = hasContentChanged(content, page.content_hash);
    if (!changed) {
        log.info({ url: normalizedUrl }, 'Content unchanged');
        await supabase.updatePage(page.id, {
            last_scraped: now,
            last_seen: now,
            error_message: null,
            firecrawl_scrape_count: (page.firecrawl_scrape_count ?? 0) + 1,
            http_status_code: scrapeResult.data.metadata.statusCode,
        });
        return {
            success: true,
            url: normalizedUrl,
            contentChanged: false,
            previousHash: page.content_hash,
            newHash,
            message: 'Content unchanged, updated timestamps',
        };
    }
    // Content changed - delete old file and upload new one
    log.info({ url: normalizedUrl }, 'Content changed, re-uploading');
    // Phase 1: DB Draft - Save new markdown and hash, set status to 'ready_for_indexing'
    await supabase.updatePage(page.id, {
        status: 'ready_for_indexing',
        title: scrapeResult.data.metadata.title,
        content_hash: newHash,
        markdown_content: content,
        http_status_code: scrapeResult.data.metadata.statusCode,
        firecrawl_scrape_count: (page.firecrawl_scrape_count ?? 0) + 1,
        metadata: {
            title: scrapeResult.data.metadata.title,
            description: scrapeResult.data.metadata.description,
            og_image: scrapeResult.data.metadata.ogImage,
            language: scrapeResult.data.metadata.language,
        },
    });
    // Phase 2: Delete old file if exists
    if (page.gemini_file_id) {
        try {
            await gemini.deleteFileFromStore(website.gemini_store_id, page.gemini_file_id);
        }
        catch (error) {
            log.warn({ url: normalizedUrl, error }, 'Failed to delete old file');
        }
    }
    // Phase 3: Upload new content to Gemini
    const geminiFile = await gemini.uploadToFileSearchStore(website.gemini_store_id, content, {
        url: normalizedUrl,
        title: scrapeResult.data.metadata.title ?? normalizedUrl,
        path: extractPath(normalizedUrl),
        lastUpdated: now,
    });
    // Phase 4: Final commit - Update with Gemini info and set to 'active'
    await supabase.updatePage(page.id, {
        status: 'active',
        gemini_file_id: geminiFile.name,
        gemini_file_name: geminiFile.displayName,
        last_scraped: now,
        last_seen: now,
        missing_count: 0,
        error_message: null,
    });
    log.info({ url: normalizedUrl }, 'Reindex complete');
    return {
        success: true,
        url: normalizedUrl,
        contentChanged: true,
        previousHash: page.content_hash,
        newHash,
        message: 'Content updated and re-indexed',
    };
}
//# sourceMappingURL=individual-url.js.map