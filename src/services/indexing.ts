/**
 * Indexing service
 * Handles uploading stored markdown content to Gemini File Search
 * This is separate from ingestion (scraping) to allow retries without re-scraping
 */

import * as supabase from '../clients/supabase.js';
import * as gemini from '../clients/gemini.js';
import { extractPath } from '../utils/url.js';
import { loggers } from '../utils/logger.js';
import type { SyncError } from '../types/index.js';

const log = loggers.ingestion; // Reuse ingestion logger for now

export interface IndexingResult {
  indexingJobId: string;
  websiteId: string;
  pagesIndexed: number;
  errors: SyncError[];
}

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
export async function indexWebsite(
  websiteId: string,
  options?: {
    ingestionJobId?: string;
    autoCreateStore?: boolean;
  }
): Promise<IndexingResult> {
  const { ingestionJobId, autoCreateStore = true } = options ?? {};
  const errors: SyncError[] = [];
  
  log.info({ websiteId, ingestionJobId }, 'Starting website indexing');

  // Get website
  const website = await supabase.getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found');
  }

  // Create indexing process job
  const indexingJob = await supabase.createProcessJob({
    website_id: websiteId,
    process_type: 'indexing',
    status: 'running',
    metadata: {
      ingestionJobId,
    },
  });

  try {
    // Step 1: Ensure Gemini store exists
    let geminiStoreId = website.gemini_store_id;
    
    if (!geminiStoreId) {
      if (autoCreateStore) {
        log.info({ websiteId }, 'Creating Gemini File Search store');
        const storeName = `website-${website.domain.replace(/\./g, '-')}-${Date.now()}`;
        const geminiStore = await gemini.createFileSearchStore(storeName);
        geminiStoreId = geminiStore.name;
        
        // Update website with store ID
        await supabase.updateWebsite(websiteId, {
          gemini_store_id: geminiStore.name,
          gemini_store_name: geminiStore.displayName,
        });
      } else {
        throw new Error('Website has no Gemini store and autoCreateStore is false');
      }
    }

    // Step 2: Get pages ready for indexing
    // Pages with status='processing' that have markdown_content but no gemini_file_id
    // Optionally filter by process job (ingestion or sync)
    const pagesToIndex = await supabase.getPagesReadyForIndexing(websiteId, {
      processJobId: ingestionJobId,
    });

    log.info(
      { 
        websiteId, 
        pagesToIndex: pagesToIndex.length 
      },
      'Pages to index'
    );

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

    // Step 3: Upload each page to Gemini
    let pagesIndexed = 0;
    const now = new Date().toISOString();

    for (const page of pagesToIndex) {
      if (!page.markdown_content) continue;

      try {
        // Upload to Gemini (page already has status='processing' from ingestion/sync)
        const geminiFile = await gemini.uploadToFileSearchStore(
          geminiStoreId,
          page.markdown_content,
          {
            url: page.url,
            title: page.title ?? page.url,
            path: page.path ?? extractPath(page.url),
            lastUpdated: now,
          }
        );

        // Update page with Gemini info and promote to 'active'
        await supabase.updatePage(page.id, {
          status: 'active',
          gemini_file_id: geminiFile.name,
          gemini_file_name: geminiFile.displayName,
          gemini_document_state: 'ACTIVE',
          last_scraped: new Date().toISOString(),
          error_message: null,
        });

        pagesIndexed++;

        if (pagesIndexed % 10 === 0) {
          log.info({ pagesIndexed, total: pagesToIndex.length }, 'Indexing progress');
        }
      } catch (pageError) {
        const message = pageError instanceof Error ? pageError.message : 'Unknown error';
        log.error({ url: page.url, error: message }, 'Failed to index page');
        errors.push({ url: page.url, error: message, timestamp: now });

        // Keep status='processing' but set error_message (can retry later)
        await supabase.updatePage(page.id, {
          error_message: message,
        });
      }
    }

    // Step 4: Update indexing job
    await supabase.updateProcessJob(indexingJob.id, {
      status: 'completed',
      urls_updated: pagesIndexed,
      urls_errored: errors.length,
      errors,
      completed_at: new Date().toISOString(),
    });

    log.info(
      {
        indexingJobId: indexingJob.id,
        websiteId,
        pagesIndexed,
        errors: errors.length,
      },
      'Indexing complete'
    );

    return {
      indexingJobId: indexingJob.id,
      websiteId,
      pagesIndexed,
      errors,
    };
  } catch (error) {
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

