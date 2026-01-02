/**
 * Individual URL indexing service
 * Handles indexing a single URL (similar to Google Search Console - add individual URL)
 * 
 * Requirements:
 * - Only works if website already exists (has pages from same domain)
 * - Uses direct scrape (not batch) for single URL
 * - Writes 'processing' status → triggers indexing pipeline
 */

import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as indexingService from './indexing.js';
import { computeContentHash } from '../utils/hash.js';
import { extractDomain, extractPath, normalizeUrl } from '../utils/url.js';
import { loggers } from '../utils/logger.js';

const log = loggers.ingestion; // Reuse ingestion logger

export interface IndividualUrlResult {
  success: boolean;
  websiteId: string;
  url: string;
  status: 'processing' | 'active' | 'error';
  error?: string;
}

/**
 * Index a single URL for an existing website
 * 
 * @param websiteId - The website ID (must exist)
 * @param url - The URL to index
 * @returns Result with status
 */
export async function indexIndividualUrl(
  websiteId: string,
  url: string
): Promise<IndividualUrlResult> {
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

  log.info(
    { websiteId, domain, existingPagesCount: existingPages.length },
    'Website verified - has existing pages'
  );

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
      } else {
        return {
          success: true,
          websiteId,
          url: normalizedUrl,
          status: 'processing', // Still processing - indexing may be in progress
        };
      }
    } catch (indexingError) {
      // Don't fail - page is written, indexing can be retried
      log.error(
        { websiteId, url: normalizedUrl, error: indexingError },
        'Indexing pipeline failed (can be retried later)'
      );
      return {
        success: true,
        websiteId,
        url: normalizedUrl,
        status: 'processing', // Written but indexing pending
      };
    }
  } catch (dbError) {
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

