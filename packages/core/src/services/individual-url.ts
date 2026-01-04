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
import { batchScrapeAndProcess } from './ingestion.js';
import { computeContentHash, hasContentChanged } from '../utils/hash.js';
import { extractDomain, extractBaseDomain, extractPath, normalizeUrl, normalizeDomain } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
import type { UrlStatusResult, ReindexResult, SyncError } from '../types/index.js';

const log = loggers.ingestion; // Reuse ingestion logger

export interface IndividualUrlResult {
  success: boolean;
  websiteId: string;
  url: string;
  status: 'processing' | 'active' | 'error';
  error?: string;
}

/**
 * Index a single URL (user-friendly function)
 * 
 * Takes just a URL and handles all the logic:
 * - Automatically finds website by domain
 * - Validates website exists and has pages
 * - Uses batchScrapeAndProcess (same as ingestion/sync)
 * - Marks as 'ready_for_indexing'
 * - Triggers indexing service (like sync does)
 * 
 * Similar to Google Search Console's "Request Indexing" feature.
 * 
 * @param url - The URL to index
 * @returns Result with status and helpful messages
 */
export async function indexIndividualUrl(
  url: string
): Promise<IndividualUrlResult & { 
  message?: string;
  suggestion?: string;
  canAutoIngest?: boolean;
}> {
  const normalizedUrl = normalizeUrl(url);
  log.info({ url: normalizedUrl }, 'Requesting indexing for URL');

  // Step 1: Extract base domain from URL
  const extractedDomain = normalizeDomain(normalizedUrl);
  const baseDomain = extractBaseDomain(extractedDomain);

  if (!baseDomain || baseDomain.trim().length === 0) {
    return {
      success: false,
      websiteId: '',
      url: normalizedUrl,
      status: 'error',
      error: 'Could not extract a valid domain from the URL',
      message: 'Invalid URL format. Please provide a valid URL (e.g., https://example.com/page)',
    };
  }

  log.info({ url: normalizedUrl, baseDomain }, 'Extracted base domain');

  // Step 2: Find website by base domain
  const website = await supabase.getWebsiteByDomain(baseDomain);

  if (!website) {
    return {
      success: false,
      websiteId: '',
      url: normalizedUrl,
      status: 'error',
      error: `Website not found for domain: ${baseDomain}`,
      message: `This domain (${baseDomain}) has never been indexed.`,
      suggestion: `Would you like to ingest and index this website? Use site_ingest with the homepage URL (e.g., https://${baseDomain})`,
      canAutoIngest: true,
    };
  }

  log.info({ websiteId: website.id, domain: website.domain }, 'Website found');

  // Step 3: Validate URL domain matches website domain
  const urlDomain = extractDomain(normalizedUrl);
  const urlBaseDomain = extractBaseDomain(urlDomain);
  
  if (urlBaseDomain !== baseDomain) {
    return {
      success: false,
      websiteId: website.id,
      url: normalizedUrl,
      status: 'error',
      error: `URL domain (${urlBaseDomain}) does not match website domain (${baseDomain})`,
      message: `The URL domain does not match the website domain. Each domain/subdomain is a separate website.`,
    };
  }

  // Step 4: Check if website has existing pages
  const existingPages = await supabase.getPagesByWebsite(website.id);
  
  if (existingPages.length === 0) {
    return {
      success: false,
      websiteId: website.id,
      url: normalizedUrl,
      status: 'error',
      error: 'Website has no existing pages',
      message: `Website exists but has no indexed pages yet.`,
      suggestion: `Would you like to ingest and index this website? Use site_ingest with the homepage URL (e.g., https://${baseDomain})`,
      canAutoIngest: true,
    };
  }

  // Step 5: Check if URL already exists
  const existingPage = await supabase.getPageByUrl(normalizedUrl);
  
  if (existingPage) {
    // Verify the existing page belongs to the same website
    if (existingPage.website_id !== website.id) {
      return {
        success: false,
        websiteId: website.id,
        url: normalizedUrl,
        status: 'error',
        error: 'URL exists but belongs to a different website',
        message: `This URL is already indexed but belongs to a different website.`,
      };
    }

    if (existingPage.status === 'active') {
      return {
        success: true,
        websiteId: website.id,
        url: normalizedUrl,
        status: 'active',
        message: 'URL is already indexed and active',
      };
    } else if (existingPage.status === 'ready_for_indexing') {
      // Already scraped, just trigger indexing
      log.info({ url: normalizedUrl }, 'URL already scraped, triggering indexing');
      try {
        await indexingService.indexWebsite(website.id, {});
        
        // Check if page is now active after indexing
        const updatedPage = await supabase.getPageByUrl(normalizedUrl);
        if (updatedPage?.status === 'active') {
          return {
            success: true,
            websiteId: website.id,
            url: normalizedUrl,
            status: 'active',
            message: 'URL was already scraped and has been indexed successfully',
          };
        }
        
        return {
          success: true,
          websiteId: website.id,
          url: normalizedUrl,
          status: 'processing',
          message: 'URL was already scraped, indexing has been triggered',
        };
      } catch (error) {
        return {
          success: true,
          websiteId: website.id,
          url: normalizedUrl,
          status: 'processing',
          message: 'URL was already scraped, indexing will be processed shortly',
        };
      }
    }
    // If status is error/pending/processing, we'll re-scrape it
  }

  // Step 6: Create process job for tracking
  const processJob = await supabase.createProcessJob({
    website_id: website.id,
    process_type: 'manual_reindex',
    status: 'running',
  });

  const errors: SyncError[] = [];

  try {
    // Step 7: Use batchScrapeAndProcess (same as ingestion/sync) for consistent behavior
    log.info({ websiteId: website.id, url: normalizedUrl }, 'Scraping URL using batch scrape');
    const { batchJobId, pagesWritten, scrapeResult } = await batchScrapeAndProcess(
      [normalizedUrl],
      website.id,
      processJob.id,
      errors,
      {
        trackProgress: false, // Single URL, no need for progress tracking
      }
    );

    if (!batchJobId || !scrapeResult.success) {
      const errorMessage = scrapeResult.error || 'Batch scrape failed';
      await supabase.updateProcessJob(processJob.id, {
        completed_at: new Date().toISOString(),
        errors,
        status: 'failed',
      });

      return {
        success: false,
        websiteId: website.id,
        url: normalizedUrl,
        status: 'error',
        error: errorMessage,
        message: `Failed to scrape URL: ${errorMessage}`,
      };
    }

    // Step 8: Check if page was written (processScrapedPages writes with status='ready_for_indexing')
    const updatedPage = await supabase.getPageByUrl(normalizedUrl);
    
    if (!updatedPage) {
      await supabase.updateProcessJob(processJob.id, {
        completed_at: new Date().toISOString(),
        errors,
        status: 'failed',
      });

      return {
        success: false,
        websiteId: website.id,
        url: normalizedUrl,
        status: 'error',
        error: 'Page was not written to database',
        message: 'URL was scraped but not written to database (likely empty or invalid content)',
      };
    }

    // Step 9: Update process job
    await supabase.updateProcessJob(processJob.id, {
      completed_at: new Date().toISOString(),
      urls_discovered: 1,
      urls_updated: pagesWritten,
      urls_errored: errors.length,
      firecrawl_batch_ids: [batchJobId],
      errors,
      status: 'completed',
    });

    // Step 10: Trigger indexing pipeline (like sync does)
    log.info({ websiteId: website.id, url: normalizedUrl }, 'Triggering indexing pipeline');
    try {
      await indexingService.indexWebsite(website.id, {});
      log.info({ websiteId: website.id, url: normalizedUrl }, 'Indexing pipeline triggered');
      
      // Check if page is now active after indexing
      const finalPage = await supabase.getPageByUrl(normalizedUrl);
      if (finalPage?.status === 'active') {
        log.info(
          { websiteId: website.id, url: normalizedUrl, status: finalPage.status },
          'URL scraped, indexed, and is now active'
        );
        
        return {
          success: true,
          websiteId: website.id,
          url: normalizedUrl,
          status: 'active',
          message: 'URL successfully scraped and indexed. The page is now searchable.',
        };
      }
    } catch (indexingError) {
      // Don't fail - page is written, indexing can be retried
      log.warn(
        { websiteId: website.id, url: normalizedUrl, error: indexingError },
        'Indexing pipeline failed (can be retried later)'
      );
    }

    log.info(
      { websiteId: website.id, url: normalizedUrl, status: updatedPage.status },
      'URL scraped, marked as ready_for_indexing, and indexing triggered'
    );

    return {
      success: true,
      websiteId: website.id,
      url: normalizedUrl,
      status: updatedPage.status === 'ready_for_indexing' ? 'processing' : updatedPage.status as 'processing' | 'active' | 'error',
      message: 'URL successfully scraped and indexing has been triggered. The page will be indexed shortly.',
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ url: normalizedUrl, error: message }, 'Failed to index URL');

    await supabase.updateProcessJob(processJob.id, {
      completed_at: new Date().toISOString(),
      errors: [...errors, { url: normalizedUrl, error: message, timestamp: new Date().toISOString() }],
      status: 'failed',
    });

    return {
      success: false,
      websiteId: website.id,
      url: normalizedUrl,
      status: 'error',
      error: message,
      message: `Failed to index URL: ${message}`,
    };
  }
}

/**
 * Get the current status of a URL
 */
export async function getUrlStatus(url: string): Promise<UrlStatusResult> {
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
export async function reindexUrl(url: string): Promise<ReindexResult> {
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
    } catch (error) {
      log.warn({ url: normalizedUrl, error }, 'Failed to delete old file');
    }
  }

  // Phase 3: Upload new content to Gemini
  const geminiFile = await gemini.uploadToFileSearchStore(
    website.gemini_store_id,
    content,
    {
      url: normalizedUrl,
      title: scrapeResult.data.metadata.title ?? normalizedUrl,
      path: extractPath(normalizedUrl),
      lastUpdated: now,
    }
  );

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


