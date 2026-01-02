/**
 * Website ingestion service
 * Handles initial crawl and indexing of a website
 */

import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as gemini from '../clients/gemini.js';
import * as syncService from './sync.js';
import * as indexingService from './indexing.js';
import { computeContentHash } from '../utils/hash.js';
import { extractDomain, extractPath, normalizeUrl, filterUrlsByDomain } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
import { validateIngestionInput } from './ingestion-validation.js';
import type {
  IngestionResult,
  ProcessJob,
  SyncError,
} from '../types/index.js';

const log = loggers.ingestion;

/**
 * Ingest a website starting from a seed URL
 *
 * Flow:
 * 1. Create Gemini File Search store
 * 2. Create website record in Supabase
 * 3. Discover all URLs via FireCrawl /map
 * 4. Batch scrape all URLs
 * 5. Write only complete scrapes to DB (status='processing')
 * 6. Discard incomplete scrapes (never write to DB)
 * 7. Trigger indexing pipeline to upload to Gemini
 */
/**
 * Check if a website already exists for a given URL
 * Extracts exact domain from URL (even with path/query) and checks for existing website
 * 
 * Example: https://www.example.com/path?query=1 -> checks for www.example.com
 * 
 * Each domain/subdomain is treated as a separate website:
 * - example.com and www.example.com are different websites
 * - subdomain.example.com is a different website
 * 
 * Returns:
 * - exists: true if website found
 * - website: existing website or null
 * - domain: extracted exact domain
 * - action: 'sync' if exists, 'ingest' if new
 */
export async function checkWebsiteExists(seedUrl: string): Promise<{
  exists: boolean;
  website: Awaited<ReturnType<typeof supabase.getWebsiteById>> | null;
  domain: string;
  action: 'sync' | 'ingest';
}> {
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const domain = extractDomain(normalizedSeedUrl);
  
  // Check by exact domain (each domain/subdomain is separate)
  const existingWebsite = await supabase.getWebsiteByDomain(domain);
  
  return {
    exists: !!existingWebsite,
    website: existingWebsite,
    domain,
    action: existingWebsite ? 'sync' : 'ingest',
  };
}

export async function ingestWebsite(
  seedUrl: string,
  displayName?: string
): Promise<IngestionResult> {
  // ========================================================================
  // STEP 0: INPUT VALIDATION (Production-grade validation with Zod)
  // ========================================================================
  try {
    const validated = validateIngestionInput(seedUrl, displayName);
    seedUrl = validated.seedUrl;
    displayName = validated.displayName;
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : 'Invalid input';
    log.error({ seedUrl, displayName, error: message }, 'Input validation failed');
    throw new Error(`Invalid ingestion input: ${message}`);
  }

  // Normalize and extract domain after validation
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const domain = extractDomain(normalizedSeedUrl);
  const siteName = displayName ?? domain;
  const errors: SyncError[] = [];

  log.info({ seedUrl: normalizedSeedUrl, domain }, 'Starting website ingestion');

  // ========================================================================
  // STEP 1: CHECK IF WEBSITE ALREADY EXISTS (by exact domain)
  // ========================================================================
  // Each domain/subdomain is treated as a separate website
  const existingWebsite = await supabase.getWebsiteByDomain(domain);
  if (existingWebsite) {
    log.info(
      { 
        domain,
        websiteId: existingWebsite.id,
        existingDisplayName: existingWebsite.display_name,
        existingDomain: existingWebsite.domain
      },
      'Website already exists (exact domain match), automatically switching to sync'
    );
    
    // Automatically run sync instead of failing
    // This ensures ingestion endpoint can handle both new and existing websites
    const syncResult = await syncService.syncWebsite(existingWebsite.id);
    
    // Return result in ingestion format for compatibility
    return {
      websiteId: existingWebsite.id,
      domain: existingWebsite.domain,
      geminiStoreId: existingWebsite.gemini_store_id ?? '',
      pagesDiscovered: syncResult.urlsDiscovered,
      pagesIndexed: syncResult.urlsUpdated,
      errors: syncResult.errors,
    };
  }

  // ========================================================================
  // STEP 2: NEW DOMAIN - REGISTER WEBSITE (Only ingestion can do this)
  // ========================================================================

  // 2a. Create Gemini File Search store (during website registration)
  // Each domain/subdomain gets its own store
  log.info({ domain }, 'Creating Gemini File Search store');
  const storeName = `website-${domain.replace(/\./g, '-')}-${Date.now()}`;
  const geminiStore = await gemini.createFileSearchStore(storeName);

  // 2b. Create website record in Supabase with store ID
  // Store is created BEFORE website record to ensure it exists
  // This is the ONLY place where new websites are registered
  log.info({ domain, storeId: geminiStore.name }, 'Creating website record with store');
  const website = await supabase.createWebsite({
    seed_url: normalizedSeedUrl,
    domain: domain, // Store exact domain (each domain/subdomain is separate)
    display_name: siteName,
    gemini_store_id: geminiStore.name,
    gemini_store_name: geminiStore.displayName,
  });

  // Step 3: Create ingestion process job
  const ingestionJob = await supabase.createProcessJob({
    website_id: website.id,
    process_type: 'ingestion',
    status: 'running',
  });

  // Step 3b: Associate ingestion job with website (ingestion creates website)
  await supabase.updateWebsite(website.id, {
    created_by_ingestion_id: ingestionJob.id,
  });

  try {
    // Step 4: Discover URLs via FireCrawl /map
    log.info({ seedUrl: normalizedSeedUrl }, 'Mapping website');
    const mapResult = await firecrawl.mapWebsite(normalizedSeedUrl);

    if (!mapResult.success) {
      throw new Error(`Failed to map website: ${mapResult.error}`);
    }

    // Filter to only include same-domain URLs (exact match only)
    // Each domain/subdomain is separate - only get pages from this exact domain
    const discoveredUrls = [...new Set(
      filterUrlsByDomain(mapResult.links, domain).map(normalizeUrl)
    )];

    log.info({ urlCount: discoveredUrls.length }, 'URLs discovered');

    if (discoveredUrls.length === 0) {
      throw new Error('No URLs discovered during mapping');
    }

    // Step 5: Start batch scrape with job ID tracking
    log.info({ urlCount: discoveredUrls.length }, 'Starting batch scrape');
    
    const batchStart = await firecrawl.batchScrapeStart(discoveredUrls);
    if (!batchStart.success) {
      throw new Error(`Batch scrape start failed: ${batchStart.error}`);
    }
    
    const batchJobId = batchStart.jobId;
    log.info({ batchJobId }, 'Batch scrape job started');

    // Wait for batch scrape to complete (long-running, up to 10 minutes)
    const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
      pollIntervalMs: 5000,
      maxWaitMs: 600000, // 10 minutes
      onProgress: (completed, total) => {
        log.debug({ completed, total }, 'Scrape progress');
      },
    });

    if (!scrapeResult.success || !scrapeResult.data) {
      throw new Error(`Batch scrape failed: ${scrapeResult.error || 'Unknown error'}`);
    }

    log.info(
      { completed: scrapeResult.completed, total: scrapeResult.total },
      'Batch scrape complete'
    );

    // Step 6: Process scraped results - only write complete scrapes
    let pagesWritten = 0;
    const now = new Date().toISOString();
    const scrapedData = scrapeResult.data ?? [];

    for (const pageData of scrapedData) {
      if (!pageData) continue;

      // ========================================================================
      // VALIDATION PHASE: Ensure we have ALL required data before writing
      // ========================================================================
      const url = pageData.metadata?.sourceURL;
      if (!url) {
        log.warn({ pageData }, 'Page missing sourceURL, skipping (discarded)');
        continue; // Discard - don't write to DB
      }

      // Validate markdown content exists and is not empty
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

      // Validate we have all required fields before proceeding
      // At this point, we have: url, markdown (non-empty)
      // We can compute: content_hash, path
      // Optional but should exist: title, statusCode, metadata

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
          website_id: website.id,
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
          created_by_ingestion_id: ingestionJob.id,
          firecrawl_batch_id: batchJobId,
        });

        pagesWritten++;

        if (pagesWritten % 10 === 0) {
          log.info({ pagesWritten, total: scrapedData.length }, 'Pages written to DB');
        }
      } catch (dbError) {
        const message = dbError instanceof Error ? dbError.message : 'Unknown error';
        log.error({ url, error: message }, 'Failed to write page to DB');
        errors.push({ url, error: message, timestamp: now });
        // Continue - don't fail entire process for one URL
      }
    }

    log.info(
      {
        discovered: discoveredUrls.length,
        scraped: scrapeResult.completed,
        written: pagesWritten,
        discarded: scrapedData.length - pagesWritten
      },
      'Ingestion scraping phase complete'
    );

    // Step 7: Update ingestion process job
    await supabase.updateProcessJob(ingestionJob.id, {
      completed_at: now,
      urls_discovered: discoveredUrls.length,
      urls_updated: pagesWritten, // Pages written to DB (status='processing')
      urls_errored: errors.length,
      firecrawl_batch_ids: [batchJobId],
      errors,
      status: 'completed',
    });

    // Step 8: Update website
    await supabase.updateWebsite(website.id, {
      last_full_crawl: now,
    });

    log.info(
      {
        websiteId: website.id,
        domain,
        pagesDiscovered: discoveredUrls.length,
        pagesScraped: pagesWritten,
        errors: errors.length,
      },
      'Ingestion scraping phase complete - triggering indexing'
    );

    // Step 9: Trigger indexing pipeline (separate process - fire and forget)
    // This will pick up pages with status='processing' and upload to Gemini
    // We don't await this - ingestion completes independently, indexing runs in background
    log.info({ websiteId: website.id, ingestionJobId: ingestionJob.id }, 'Triggering indexing pipeline (async)');
    
    // Fire and forget - indexing runs independently
    indexingService.indexWebsite(website.id, {
      ingestionJobId: ingestionJob.id,
    }).then((indexingResult) => {
      log.info(
        {
          websiteId: website.id,
          pagesIndexed: indexingResult.pagesIndexed,
          indexingErrors: indexingResult.errors.length,
        },
        'Indexing pipeline complete (background)'
      );
    }).catch((indexingError) => {
      // Don't fail ingestion if indexing fails - it can be retried later
      log.error(
        { websiteId: website.id, error: indexingError },
        'Indexing pipeline failed (can be retried later)'
      );
    });

    return {
      websiteId: website.id,
      domain,
      geminiStoreId: geminiStore.name,
      pagesDiscovered: discoveredUrls.length,
      pagesIndexed: pagesWritten, // Pages written (indexing will promote to 'active')
      errors,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Update ingestion job with failure
    await supabase.updateProcessJob(ingestionJob.id, {
      completed_at: new Date().toISOString(),
      errors: [...errors, { url: seedUrl, error: message, timestamp: new Date().toISOString() }],
      status: 'failed',
    });

    log.error({ websiteId: website.id, error: message }, 'Ingestion failed');
    throw error;
  }
}

/**
 * Get ingestion status for a website
 */
export async function getIngestionStatus(websiteId: string): Promise<{
  website: NonNullable<Awaited<ReturnType<typeof supabase.getWebsiteById>>>;
  totalPages: number;
  activePages: number;
  pendingPages: number;
  errorPages: number;
  deletedPages: number;
  lastSync: ProcessJob | null;
}> {
  const website = await supabase.getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  const allPages = await supabase.getPagesByWebsite(websiteId);
  // Get latest sync process job (or any process job)
  const processJobs = await supabase.getProcessJobs(websiteId, {
    processType: 'sync',
    limit: 1,
  });
  const lastSync = processJobs.length > 0 ? processJobs[0] : null;

  return {
    website,
    totalPages: allPages.length,
    activePages: allPages.filter((p) => p.status === 'active').length,
    pendingPages: allPages.filter((p) => p.status === 'pending').length,
    errorPages: allPages.filter((p) => p.status === 'error').length,
    deletedPages: allPages.filter((p) => p.status === 'deleted').length,
    lastSync,
  };
}

/**
 * List all ingested websites
 */
export async function listWebsites(): Promise<Array<{
  id: string;
  domain: string;
  displayName: string;
  pageCount: number;
  lastCrawl: string | null;
}>> {
  const websites = await supabase.getAllWebsites();

  const results = await Promise.all(
    websites.map(async (website) => {
      const pages = await supabase.getActivePages(website.id);
      return {
        id: website.id,
        domain: website.domain,
        displayName: website.display_name,
        pageCount: pages.length,
        lastCrawl: website.last_full_crawl,
      };
    })
  );

  return results;
}
