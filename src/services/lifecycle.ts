/**
 * URL lifecycle management service
 * Handles individual URL operations: status, reindex, deletion
 */

import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as gemini from '../clients/gemini.js';
import { hasContentChanged } from '../utils/hash.js';
import { extractPath, normalizeUrl } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
import type { UrlStatusResult, ReindexResult } from '../types/index.js';

const log = loggers.lifecycle;

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

  // Phase 1: DB Draft - Save new markdown and hash, set status to 'processing'
  await supabase.updatePage(page.id, {
    status: 'processing',
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

/**
 * Mark a URL as deleted and remove from Gemini index
 */
export async function markDeleted(pageId: string): Promise<void> {
  log.info({ pageId }, 'Marking page as deleted');

  const page = await supabase.getPageById(pageId);
  if (!page) {
    throw new Error('Page not found');
  }

  // Get website for Gemini store reference
  const website = await supabase.getWebsiteById(page.website_id);

  // Delete from Gemini if file exists
  if (page.gemini_file_id && website?.gemini_store_id) {
    try {
      await gemini.deleteFileFromStore(website.gemini_store_id, page.gemini_file_id);
      log.info({ pageId, fileId: page.gemini_file_id }, 'Removed from Gemini');
    } catch (error) {
      log.warn({ pageId, error }, 'Failed to delete from Gemini');
    }
  }

  // Mark as deleted in Supabase
  await supabase.updatePage(pageId, {
    status: 'deleted',
    gemini_file_id: undefined,
    gemini_file_name: undefined,
  });

  log.info({ pageId, url: page.url }, 'Page marked as deleted');
}

/**
 * Mark a URL as deleted by URL
 */
export async function markDeletedByUrl(url: string): Promise<void> {
  const normalizedUrl = normalizeUrl(url);
  const page = await supabase.getPageByUrl(normalizedUrl);

  if (!page) {
    throw new Error(`URL not found: ${normalizedUrl}`);
  }

  await markDeleted(page.id);
}

/**
 * Restore a deleted page (re-scrape and re-index)
 */
export async function restorePage(pageId: string): Promise<ReindexResult> {
  log.info({ pageId }, 'Restoring page');

  const page = await supabase.getPageById(pageId);
  if (!page) {
    throw new Error('Page not found');
  }

  if (page.status !== 'deleted') {
    throw new Error('Page is not deleted');
  }

  // Re-index will handle scraping and uploading
  return reindexUrl(page.url);
}

/**
 * Add a new URL to an existing website index
 * 
 * @deprecated Use individual-url.indexIndividualUrl() instead
 * This function is kept for backward compatibility but delegates to the new service
 */
export async function addUrl(
  websiteId: string,
  url: string
): Promise<ReindexResult> {
  const normalizedUrl = normalizeUrl(url);
  log.info({ websiteId, url: normalizedUrl }, 'Adding new URL (using individual URL indexing service)');

  // Check if URL already exists
  const existingPage = await supabase.getPageByUrl(normalizedUrl);
  if (existingPage) {
    // Re-index existing page
    return reindexUrl(normalizedUrl);
  }

  // Use new individual URL indexing service
  const individualUrlService = await import('./individual-url.js');
  const result = await individualUrlService.indexIndividualUrl(websiteId, normalizedUrl);

  if (!result.success) {
    return {
      success: false,
      url: normalizedUrl,
      contentChanged: false,
      previousHash: null,
      newHash: '',
      message: result.error || 'Failed to index URL',
    };
  }

  // Get the page to return hash info
  const page = await supabase.getPageByUrl(normalizedUrl);
  return {
    success: true,
    url: normalizedUrl,
    contentChanged: true,
    previousHash: null,
    newHash: page?.content_hash || '',
    message: `URL indexed (status: ${result.status})`,
  };
}

/**
 * Get all pages for a website with optional status filter
 */
export async function getPages(
  websiteId: string,
  status?: 'active' | 'pending' | 'error' | 'deleted'
): Promise<Array<{
  url: string;
  title: string | null;
  status: string;
  lastScraped: string | null;
}>> {
  const pages = await supabase.getPagesByWebsite(websiteId, status);

  return pages.map((page) => ({
    url: page.url,
    title: page.title,
    status: page.status,
    lastScraped: page.last_scraped,
  }));
}
