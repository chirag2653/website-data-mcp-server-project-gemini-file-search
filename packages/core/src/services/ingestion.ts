/**
 * Website ingestion service
 * Handles initial crawl and indexing of a website
 */

import * as supabase from '../clients/supabase.js';
import * as firecrawl from '../clients/firecrawl.js';
import * as gemini from '../clients/gemini.js';
import { computeContentHash } from '../utils/hash.js';
import { extractDomain, extractBaseDomain, extractPath, normalizeUrl, filterUrlsByDomain } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
import { z } from 'zod';
import type {
  IngestionResult,
  ProcessJob,
  SyncError,
} from '../types/index.js';

const log = loggers.ingestion;

/**
 * Process scraped page data and write to database
 * 
 * This shared function handles validation, data preparation, and atomic writes
 * for both main ingestion flow and recovery flow.
 * 
 * @param scrapedData - Array of scraped page data from FireCrawl
 * @param websiteId - The website ID to associate pages with
 * @param ingestionJobId - The ingestion job ID for lineage tracking
 * @param batchJobId - The FireCrawl batch job ID
 * @param errors - Array to append errors to (mutated in place)
 * @returns Number of pages successfully written to database
 */
async function processScrapedPages(
  scrapedData: Array<any>,
  websiteId: string,
  ingestionJobId: string,
  batchJobId: string,
  errors: SyncError[]
): Promise<number> {
  let pagesWritten = 0;
  const now = new Date().toISOString();

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
        website_id: websiteId,
        url,
        path,
        title: pageData.metadata?.title,
        status: 'ready_for_indexing', // Page scraped, markdown stored, ready for indexing service to pick up
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
        created_by_ingestion_id: ingestionJobId,
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

  return pagesWritten;
}

/**
 * Ingest a website starting from a seed URL
 *
 * Flow:
 * 1. Create Gemini File Search store
 * 2. Create website record in Supabase
 * 3. Discover all URLs via FireCrawl /map
 * 4. Batch scrape all URLs
 * 5. Write only complete scrapes to DB (status='ready_for_indexing')
 * 6. Discard incomplete scrapes (never write to DB)
 * 7. Trigger indexing pipeline to upload to Gemini
 */
/**
 * Check if a website already exists for a given URL
 * 
 * IMPORTANT: This function is READ-ONLY. It only queries the database.
 * It does NOT create any records, start any processes, or modify any data.
 * 
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
  // READ-ONLY operation: Only queries database, does not create or modify anything
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const extractedDomain = extractDomain(normalizedSeedUrl);
  const baseDomain = extractBaseDomain(extractedDomain); // Check by base domain
  
  // Check by base domain so www and non-www resolve to same website
  // This is a SELECT query only - no INSERT, UPDATE, or DELETE
  const existingWebsite = await supabase.getWebsiteByDomain(baseDomain);
  
  return {
    exists: !!existingWebsite,
    website: existingWebsite,
    domain: baseDomain,
    action: existingWebsite ? 'sync' : 'ingest',
  };
}

export async function ingestWebsite(
  seedUrl: string,
  displayName?: string
): Promise<IngestionResult> {
  // ========================================================================
  // STEP 0: INPUT VALIDATION
  // ========================================================================
  try {
    // Validate seed URL
    const urlSchema = z
      .string()
      .min(1, 'URL or domain is required')
      .refine(
        (input) => {
          try {
            const url = new URL(input.startsWith('http') ? input : `https://${input}`);
            return url.hostname.length > 0 && url.hostname.includes('.');
          } catch {
            const domainPattern = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
            return domainPattern.test(input);
          }
        },
        { message: 'Input must be a valid URL or domain (e.g., https://example.com or example.com)' }
      );
    
    seedUrl = urlSchema.parse(seedUrl);
    
    // Validate display name if provided
    if (displayName) {
      const displayNameSchema = z
        .string()
        .min(1, 'Display name cannot be empty')
        .max(512, 'Display name must be 512 characters or less');
      displayName = displayNameSchema.parse(displayName);
    }
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : 'Invalid input';
    log.error({ seedUrl, displayName, error: message }, 'Input validation failed');
    throw new Error(`Invalid ingestion input: ${message}`);
  }

  // Normalize and extract base domain after validation
  // Store base domain (without www) in Supabase for consistency
  const normalizedSeedUrl = normalizeUrl(seedUrl);
  const extractedDomain = extractDomain(normalizedSeedUrl);
  const baseDomain = extractBaseDomain(extractedDomain); // Remove www for storage
  const siteName = displayName ?? baseDomain;
  const errors: SyncError[] = [];

  log.info({ seedUrl: normalizedSeedUrl, extractedDomain, baseDomain }, 'Starting website ingestion');

  // ========================================================================
  // STEP 1: CHECK IF WEBSITE ALREADY EXISTS (by base domain)
  // ========================================================================
  // Check by base domain so www and non-www resolve to same website
  const existingWebsite = await supabase.getWebsiteByDomain(baseDomain);
  if (existingWebsite) {
    log.info(
      { 
        baseDomain,
        websiteId: existingWebsite.id,
        existingDisplayName: existingWebsite.display_name,
        existingDomain: existingWebsite.domain
      },
      'Website already exists - checking for stuck ingestion jobs'
    );
    
    // Check for existing ingestion jobs for this website
    const existingJobs = await supabase.getProcessJobs(existingWebsite.id, {
      processType: 'ingestion',
      limit: 1,
    });

    if (existingJobs.length > 0) {
      const lastJob = existingJobs[0];
      
      // Check if last job is stuck (status='running' and older than 1 minute)
      const jobAge = Date.now() - new Date(lastJob.started_at).getTime();
      const isStuck = lastJob.status === 'running' && jobAge > 60000; // 1 minute threshold

      if (isStuck) {
        log.info(
          { ingestionJobId: lastJob.id, jobAge: Math.round(jobAge / 1000) + 's' },
          'Found stuck ingestion job for existing website - attempting recovery'
        );

        const recoveryResult = await recoverIngestionJob(lastJob.id);

        if (recoveryResult.recovered && recoveryResult.status === 'completed' && recoveryResult.result) {
          log.info({ ingestionJobId: lastJob.id }, 'Successfully recovered stuck ingestion job');
          return recoveryResult.result;
        } else if (recoveryResult.status === 'still_running') {
          log.info(
            { ingestionJobId: lastJob.id },
            'Ingestion job is still running in FireCrawl - will continue monitoring'
          );
          // Job is actually still running, so we should not start a new one
          throw new Error(
            `Ingestion is already in progress for this website. Job ID: ${lastJob.id}. ` +
            `FireCrawl batch is still running. Please wait for it to complete.`
          );
        } else {
          log.warn(
            { ingestionJobId: lastJob.id, recoveryStatus: recoveryResult.status, error: recoveryResult.error },
            'Recovery failed or job was already failed - will start new ingestion'
          );
          // Recovery failed or job was already failed, proceed with new ingestion
        }
      } else if (lastJob.status === 'completed') {
        log.info(
          { ingestionJobId: lastJob.id },
          'Last ingestion job was already completed for this website'
        );
        // Last job completed successfully - ingestion already done
        // Return the existing result
        const pages = await supabase.getPagesByWebsite(existingWebsite.id);
        return {
          websiteId: existingWebsite.id,
          domain: existingWebsite.domain,
          geminiStoreId: existingWebsite.gemini_store_id ?? '',
          pagesDiscovered: lastJob.urls_discovered ?? 0,
          pagesIndexed: pages.filter((p) => p.status === 'ready_for_indexing' || p.status === 'active').length,
          errors: lastJob.errors ?? [],
          ingestionJobId: lastJob.id,
        };
      }
    }

    // Website exists but no ingestion job or recovery failed - proceed with new ingestion
    // Note: We don't automatically switch to sync - that's controlled separately via UI or code
    log.info(
      { websiteId: existingWebsite.id },
      'Website exists but no active ingestion job - proceeding with new ingestion'
    );
  }

  // ========================================================================
  // STEP 2: CREATE OR USE EXISTING WEBSITE
  // ========================================================================

  let website = existingWebsite;

  // If website doesn't exist, create it
  if (!website) {
    // 2a. Create Gemini File Search store (during website registration)
    log.info({ baseDomain }, 'Creating Gemini File Search store');
    const storeName = `website-${baseDomain.replace(/\./g, '-')}-${Date.now()}`;
    const geminiStore = await gemini.createFileSearchStore(storeName);

    // 2b. Create website record in Supabase with store ID
    // Store is created BEFORE website record to ensure it exists
    // This is the ONLY place where new websites are registered
    // Store base domain (without www) for consistency
    log.info({ baseDomain, storeId: geminiStore.name }, 'Creating website record with store');
    website = await supabase.createWebsite({
      seed_url: normalizedSeedUrl,
      domain: baseDomain, // Store base domain (www removed) so www and non-www resolve to same website
      display_name: siteName,
      gemini_store_id: geminiStore.name,
      gemini_store_name: geminiStore.displayName,
    });

    // Step 2c: Check for stuck ingestion jobs for newly created website
    // This handles cases where website was created but ingestion crashed
    log.info({ websiteId: website.id }, 'Checking for stuck ingestion jobs for newly created website');
    const newWebsiteJobs = await supabase.getProcessJobs(website.id, {
      processType: 'ingestion',
      limit: 1,
    });

    if (newWebsiteJobs.length > 0) {
      const lastJob = newWebsiteJobs[0];
      
      // Check if last job is stuck (status='running' and older than 1 minute)
      const jobAge = Date.now() - new Date(lastJob.started_at).getTime();
      const isStuck = lastJob.status === 'running' && jobAge > 60000; // 1 minute threshold

      if (isStuck) {
        log.info(
          { ingestionJobId: lastJob.id, jobAge: Math.round(jobAge / 1000) + 's' },
          'Found stuck ingestion job - attempting recovery'
        );

        const recoveryResult = await recoverIngestionJob(lastJob.id);

        if (recoveryResult.recovered && recoveryResult.status === 'completed' && recoveryResult.result) {
          log.info({ ingestionJobId: lastJob.id }, 'Successfully recovered stuck ingestion job');
          return recoveryResult.result;
        } else if (recoveryResult.status === 'still_running') {
          log.info(
            { ingestionJobId: lastJob.id },
            'Ingestion job is still running in FireCrawl - will continue monitoring'
          );
          throw new Error(
            `Ingestion is already in progress for this website. Job ID: ${lastJob.id}. ` +
            `FireCrawl batch is still running. Please wait for it to complete.`
          );
        } else {
          log.warn(
            { ingestionJobId: lastJob.id, recoveryStatus: recoveryResult.status, error: recoveryResult.error },
            'Recovery failed or job was already failed - will start new ingestion'
          );
        }
      } else if (lastJob.status === 'completed') {
        log.info(
          { ingestionJobId: lastJob.id },
          'Last ingestion job was already completed - returning existing result'
        );
        const pages = await supabase.getPagesByWebsite(website.id);
        return {
          websiteId: website.id,
          domain: website.domain,
          geminiStoreId: website.gemini_store_id ?? '',
          pagesDiscovered: lastJob.urls_discovered ?? 0,
          pagesIndexed: pages.filter((p) => p.status === 'ready_for_indexing' || p.status === 'active').length,
          errors: lastJob.errors ?? [],
          ingestionJobId: lastJob.id,
        };
      }
    }
  }

  // Step 3: Create ingestion process job (no stuck job found, or recovery failed)
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

    log.info(
      { 
        totalLinks: mapResult.links.length, 
        baseDomain, 
        sampleLinks: mapResult.links.slice(0, 5) 
      },
      'FireCrawl mapping result'
    );

    // Filter to only include URLs from the base domain
    // This accepts both www and non-www versions since we store base domain
    const filteredUrls = filterUrlsByDomain(mapResult.links, baseDomain);
    
    log.info(
      { 
        beforeFilter: mapResult.links.length, 
        afterFilter: filteredUrls.length,
        baseDomain,
        sampleFiltered: filteredUrls.slice(0, 5)
      },
      'URL filtering result'
    );

    const discoveredUrls = [...new Set(
      filteredUrls.map(normalizeUrl)
    )];

    log.info({ urlCount: discoveredUrls.length, baseDomain }, 'URLs discovered after normalization');

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

    // Store batch job ID immediately for crash recovery and UI polling
    await supabase.updateProcessJob(ingestionJob.id, {
      firecrawl_batch_ids: [batchJobId],
    });
    log.info({ batchJobId, ingestionJobId: ingestionJob.id }, 'Batch job ID stored in process_job');

    // Wait for batch scrape to complete (long-running, up to 10 minutes)
    // Update progress in database every 30 seconds for UI polling
    let lastProgressUpdate = Date.now();
    const scrapeResult = await firecrawl.batchScrapeWait(batchJobId, {
      pollIntervalMs: 5000,
      maxWaitMs: 600000, // 10 minutes
      onProgress: async (completed, total) => {
        log.debug({ completed, total }, 'Scrape progress');
        
        // Update progress in database every 30 seconds for UI polling
        const now = Date.now();
        if (now - lastProgressUpdate >= 30000) {
          lastProgressUpdate = now;
          const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;
          await supabase.updateProcessJob(ingestionJob.id, {
            metadata: {
              progress: {
                completed,
                total,
                percentage,
              },
            },
          });
          log.info(
            { ingestionJobId: ingestionJob.id, completed, total, percentage },
            'Updated ingestion progress in database'
          );
        }
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
    const scrapedData = scrapeResult.data ?? [];
    const pagesWritten = await processScrapedPages(
      scrapedData,
      website.id,
      ingestionJob.id,
      batchJobId,
      errors
    );

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
    const now = new Date().toISOString();
    await supabase.updateProcessJob(ingestionJob.id, {
      completed_at: now,
      urls_discovered: discoveredUrls.length,
      urls_updated: pagesWritten, // Pages written to DB (status='ready_for_indexing')
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
        baseDomain,
        pagesDiscovered: discoveredUrls.length,
        pagesScraped: pagesWritten,
        errors: errors.length,
      },
      'Ingestion complete - pages ready for indexing'
    );

    // Note: Indexing is NOT triggered automatically
    // Pages are stored with status='ready_for_indexing'
    // Indexing must be triggered separately via UI or direct service call

    return {
      websiteId: website.id,
      domain: baseDomain,
      geminiStoreId: website.gemini_store_id ?? '',
      pagesDiscovered: discoveredUrls.length,
      pagesIndexed: pagesWritten, // Pages written (indexing will promote to 'active')
      errors,
      ingestionJobId: ingestionJob.id, // Include job ID for UI polling
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    // Update ingestion job with failure (only if job was created)
    // Note: ingestionJob might not exist if error occurred before job creation
    if (ingestionJob?.id) {
      try {
        await supabase.updateProcessJob(ingestionJob.id, {
          completed_at: new Date().toISOString(),
          errors: [...errors, { url: seedUrl, error: message, timestamp: new Date().toISOString() }],
          status: 'failed',
        });
      } catch (updateError) {
        // Log but don't throw - we're already in error handling
        log.error(
          { ingestionJobId: ingestionJob.id, updateError },
          'Failed to update ingestion job status during error handling'
        );
      }
    }

    // Safe access - website might not exist if error occurred during website creation
    // or Gemini store creation (before website record was created)
    log.error(
      {
        websiteId: website?.id,
        baseDomain,
        error: message,
        hasIngestionJob: !!ingestionJob?.id,
      },
      'Ingestion failed'
    );
    throw error;
  }
}

/**
 * Recover a stuck ingestion job by checking FireCrawl status and resuming processing
 * 
 * This function:
 * 1. Checks if the job is actually stuck (status='running')
 * 2. Gets the batch job ID from the process_job
 * 3. Checks FireCrawl's status for that batch job
 * 4. If FireCrawl says 'completed', processes the results and marks job as 'completed'
 * 5. If FireCrawl says 'failed', marks job as 'failed'
 * 6. If FireCrawl says 'scraping', updates progress but keeps status as 'running'
 */
export async function recoverIngestionJob(ingestionJobId: string): Promise<{
  recovered: boolean;
  status: 'completed' | 'failed' | 'still_running' | 'cannot_recover';
  result?: IngestionResult;
  error?: string;
}> {
  log.info({ ingestionJobId }, 'Attempting to recover ingestion job');

  // Step 1: Get the stuck job from database
  const job = await supabase.getProcessJob(ingestionJobId);
  if (!job) {
    return {
      recovered: false,
      status: 'cannot_recover',
      error: 'Ingestion job not found',
    };
  }

  // Step 2: Check if it's actually stuck
  if (job.status !== 'running') {
    log.info({ ingestionJobId, status: job.status }, 'Job is not stuck, no recovery needed');
    return {
      recovered: false,
      status: job.status === 'completed' ? 'completed' : 'failed',
      error: `Job is already ${job.status}`,
    };
  }

  // Step 3: Get the batch job ID we stored earlier
  const batchJobId = job.firecrawl_batch_ids?.[0];
  if (!batchJobId) {
    log.error({ ingestionJobId }, 'No batch job ID found - cannot recover');
    await supabase.updateProcessJob(ingestionJobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      errors: [
        {
          url: '',
          error: 'No batch job ID found - cannot recover from crash',
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return {
      recovered: false,
      status: 'cannot_recover',
      error: 'No batch job ID found - cannot recover',
    };
  }

  log.info({ ingestionJobId, batchJobId }, 'Found batch job ID, checking FireCrawl status');

  // Step 4: Ask FireCrawl "Hey, what's the status of this batch job?"
  const firecrawlStatus = await firecrawl.batchScrapeStatus(batchJobId);

  if (!firecrawlStatus.success) {
    log.error({ ingestionJobId, batchJobId, error: firecrawlStatus.error }, 'FireCrawl status check failed');
    await supabase.updateProcessJob(ingestionJobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      errors: [
        {
          url: '',
          error: firecrawlStatus.error || 'Failed to check FireCrawl status',
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return {
      recovered: false,
      status: 'failed',
      error: firecrawlStatus.error || 'Failed to check FireCrawl status',
    };
  }

  // Step 5: Based on FireCrawl's answer, update our database
  if (firecrawlStatus.status === 'completed' && firecrawlStatus.data) {
    // FireCrawl says: "I'm done! Here's all the scraped data"
    // But our process crashed before we could process it
    // So we need to process it NOW
    log.info(
      { ingestionJobId, batchJobId, completed: firecrawlStatus.completed, total: firecrawlStatus.total },
      'FireCrawl batch completed - processing results'
    );

    const website = await supabase.getWebsiteById(job.website_id);
    if (!website) {
      return {
        recovered: false,
        status: 'cannot_recover',
        error: 'Website not found',
      };
    }

    // Process the batch results (same logic as main ingestion)
    const errors: SyncError[] = [];
    const scrapedData = firecrawlStatus.data ?? [];
    const pagesWritten = await processScrapedPages(
      scrapedData,
      website.id,
      ingestionJobId,
      batchJobId,
      errors
    );

    // Mark job as completed
    const now = new Date().toISOString();
    await supabase.updateProcessJob(ingestionJobId, {
      completed_at: now,
      urls_discovered: scrapedData.length,
      urls_updated: pagesWritten,
      urls_errored: errors.length,
      firecrawl_batch_ids: [batchJobId],
      errors,
      status: 'completed',
    });

    // Update website
    await supabase.updateWebsite(website.id, {
      last_full_crawl: now,
    });

    log.info(
      {
        ingestionJobId,
        websiteId: website.id,
        pagesWritten,
        errors: errors.length,
      },
      'Ingestion job recovered successfully'
    );

    return {
      recovered: true,
      status: 'completed',
      result: {
        websiteId: website.id,
        domain: website.domain,
        geminiStoreId: website.gemini_store_id ?? '',
        pagesDiscovered: scrapedData.length,
        pagesIndexed: pagesWritten,
        errors,
        ingestionJobId: ingestionJobId,
      },
    };
  } else if (firecrawlStatus.status === 'failed') {
    // FireCrawl says: "The batch job failed"
    log.error({ ingestionJobId, batchJobId, error: firecrawlStatus.error }, 'FireCrawl batch failed');
    await supabase.updateProcessJob(ingestionJobId, {
      status: 'failed',
      completed_at: new Date().toISOString(),
      errors: [
        {
          url: '',
          error: firecrawlStatus.error || 'Batch scrape failed',
          timestamp: new Date().toISOString(),
        },
      ],
    });
    return {
      recovered: false,
      status: 'failed',
      error: firecrawlStatus.error || 'Batch scrape failed',
    };
  } else {
    // FireCrawl says: "I'm still working on it" (status === 'scraping')
    log.info(
      {
        ingestionJobId,
        batchJobId,
        completed: firecrawlStatus.completed,
        total: firecrawlStatus.total,
      },
      'FireCrawl batch still in progress - updating progress'
    );
    // Update progress but keep status as 'running'
    await supabase.updateProcessJob(ingestionJobId, {
      metadata: {
        progress: {
          completed: firecrawlStatus.completed,
          total: firecrawlStatus.total,
          percentage: firecrawlStatus.total > 0 ? Math.round((firecrawlStatus.completed / firecrawlStatus.total) * 100) : 0,
        },
      },
    });
    return {
      recovered: false,
      status: 'still_running',
      error: 'Batch scrape is still in progress',
    };
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
