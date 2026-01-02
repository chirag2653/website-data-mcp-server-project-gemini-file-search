/**
 * FireCrawl client using direct API calls
 * Based on: https://docs.firecrawl.dev/api-reference
 */

import { config } from '../config.js';
import { loggers } from '../utils/logger.js';
import type {
  FireCrawlMapResult,
  FireCrawlScrapeResult,
  FireCrawlBatchResult,
} from '../types/index.js';

const log = loggers.firecrawl;

const FIRECRAWL_BASE_URL = 'https://api.firecrawl.dev/v2';

/**
 * Make authenticated request to FireCrawl API
 */
async function firecrawlRequest<T>(
  endpoint: string,
  options: {
    method: 'GET' | 'POST' | 'DELETE';
    body?: Record<string, unknown>;
  }
): Promise<T> {
  const url = `${FIRECRAWL_BASE_URL}${endpoint}`;

  const response = await fetch(url, {
    method: options.method,
    headers: {
      'Authorization': `Bearer ${config.firecrawl.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`FireCrawl API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<T>;
}

// ============================================================================
// Map Endpoint - URL Discovery
// POST /v2/map
// ============================================================================

interface MapApiResponse {
  success: boolean;
  links?: Array<{ url: string; title?: string; description?: string } | string>;
  error?: string;
}

/**
 * Discover all URLs on a website using FireCrawl's map endpoint
 *
 * @param seedUrl - The starting URL to map from
 * @param options - Optional configuration
 */
export async function mapWebsite(
  seedUrl: string,
  options?: {
    search?: string;
    includeSubdomains?: boolean;
    limit?: number;
    timeout?: number;
  }
): Promise<FireCrawlMapResult> {
  log.info({ seedUrl, options }, 'Starting website mapping');

  try {
    const response = await firecrawlRequest<MapApiResponse>('/map', {
      method: 'POST',
      body: {
        url: seedUrl,
        includeSubdomains: options?.includeSubdomains ?? false,
        limit: options?.limit ?? 5000,
        ...(options?.search && { search: options.search }),
        ...(options?.timeout && { timeout: options.timeout }),
      },
    });

    if (!response.success) {
      log.error({ seedUrl, error: response.error }, 'Map failed');
      return {
        success: false,
        links: [],
        error: response.error || 'Unknown error during mapping',
      };
    }

    // Normalize links - API can return strings or objects
    const links = (response.links ?? []).map((link) =>
      typeof link === 'string' ? link : link.url
    );

    log.info({ seedUrl, urlCount: links.length }, 'Mapping complete');

    return {
      success: true,
      links,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ seedUrl, error: message }, 'Map request failed');
    return {
      success: false,
      links: [],
      error: message,
    };
  }
}

// ============================================================================
// Scrape Endpoint - Single URL
// POST /v2/scrape
// ============================================================================

interface ScrapeApiResponse {
  success: boolean;
  data?: {
    markdown?: string;
    html?: string;
    rawHtml?: string;
    links?: string[];
    screenshot?: string;
    metadata?: {
      title?: string;
      description?: string;
      language?: string;
      sourceURL?: string;
      statusCode?: number;
      ogImage?: string;
      [key: string]: unknown;
    };
  };
  error?: string;
}

/**
 * Scrape a single URL
 *
 * @param url - The URL to scrape
 * @param options - Optional configuration
 */
export async function scrapeUrl(
  url: string,
  options?: {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
    timeout?: number;
  }
): Promise<FireCrawlScrapeResult> {
  log.debug({ url }, 'Scraping URL');

  try {
    const response = await firecrawlRequest<ScrapeApiResponse>('/scrape', {
      method: 'POST',
      body: {
        url,
        formats: options?.formats ?? ['markdown'],
        onlyMainContent: options?.onlyMainContent ?? true,
        ...(options?.includeTags && { includeTags: options.includeTags }),
        ...(options?.excludeTags && { excludeTags: options.excludeTags }),
        ...(options?.waitFor && { waitFor: options.waitFor }),
        ...(options?.timeout && { timeout: options.timeout }),
      },
    });

    if (!response.success || !response.data) {
      log.warn({ url, error: response.error }, 'Scrape failed');
      return {
        success: false,
        error: response.error || 'Unknown error during scraping',
      };
    }

    // Preserve all metadata fields from FireCrawl, not just the ones we explicitly use
    const metadata = response.data.metadata ?? {};
    
    return {
      success: true,
      data: {
        markdown: response.data.markdown ?? '',
        html: response.data.html,
        metadata: {
          // Explicitly map known fields
          title: metadata.title,
          description: metadata.description,
          ogImage: metadata.ogImage,
          sourceURL: metadata.sourceURL ?? url,
          statusCode: metadata.statusCode ?? 200,
          language: typeof metadata.language === 'string' ? metadata.language : undefined,
          // Preserve all other metadata fields
          ...Object.fromEntries(
            Object.entries(metadata).filter(([key]) => 
              !['title', 'description', 'ogImage', 'sourceURL', 'statusCode', 'language'].includes(key)
            )
          ),
        },
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ url, error: message }, 'Scrape request failed');
    return {
      success: false,
      error: message,
    };
  }
}

// ============================================================================
// Batch Scrape Endpoint - Multiple URLs (Async)
// POST /v2/batch/scrape
// ============================================================================

interface BatchScrapeStartResponse {
  success: boolean;
  id?: string;
  url?: string;
  invalidURLs?: string[];
  error?: string;
}

interface BatchScrapeStatusResponse {
  success?: boolean;
  status: 'scraping' | 'completed' | 'failed';
  total: number;
  completed: number;
  creditsUsed?: number;
  expiresAt?: string;
  next?: string; // Pagination URL for large responses
  data?: Array<{
    markdown?: string;
    html?: string;
    metadata?: {
      title?: string;
      description?: string;
      sourceURL?: string;
      statusCode?: number;
      ogImage?: string;
      error?: string;
      [key: string]: unknown;
    };
  }>;
  error?: string;
}

/**
 * Start a batch scrape job for multiple URLs
 * Returns immediately with a job ID that can be polled
 *
 * @param urls - Array of URLs to scrape
 * @param options - Optional configuration
 */
export async function batchScrapeStart(
  urls: string[],
  options?: {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    maxConcurrency?: number;
    ignoreInvalidURLs?: boolean;
  }
): Promise<{ success: true; jobId: string } | { success: false; error: string }> {
  log.info({ urlCount: urls.length }, 'Starting batch scrape');

  try {
    const response = await firecrawlRequest<BatchScrapeStartResponse>('/batch/scrape', {
      method: 'POST',
      body: {
        urls,
        formats: options?.formats ?? ['markdown'],
        onlyMainContent: options?.onlyMainContent ?? true,
        ignoreInvalidURLs: options?.ignoreInvalidURLs ?? true,
        ...(options?.maxConcurrency && { maxConcurrency: options.maxConcurrency }),
      },
    });

    if (!response.success || !response.id) {
      log.error({ error: response.error }, 'Batch scrape start failed');
      return {
        success: false,
        error: response.error || 'Failed to start batch scrape',
      };
    }

    log.info({ jobId: response.id }, 'Batch scrape started');
    return {
      success: true,
      jobId: response.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ error: message }, 'Batch scrape request failed');
    return {
      success: false,
      error: message,
    };
  }
}

/**
 * Check batch scrape job status
 * GET /v2/batch/scrape/{id}
 *
 * @param jobId - The batch job ID
 */
export async function batchScrapeStatus(jobId: string): Promise<FireCrawlBatchResult> {
  try {
    const response = await firecrawlRequest<BatchScrapeStatusResponse>(
      `/batch/scrape/${jobId}`,
      { method: 'GET' }
    );

    // Validate response structure
    if (!response || typeof response !== 'object') {
      throw new Error('Invalid response format from FireCrawl API');
    }

    // Check if response indicates failure
    if (response.success === false || response.error) {
      return {
        success: false,
        id: jobId,
        status: 'failed',
        completed: 0,
        total: 0,
        error: response.error || 'Batch scrape failed',
      };
    }

    // Validate required fields
    if (typeof response.status !== 'string') {
      log.warn({ jobId, response }, 'Response missing status field');
      return {
        success: false,
        id: jobId,
        status: 'failed',
        completed: 0,
        total: 0,
        error: 'Invalid response: missing status field',
      };
    }

    // Map batch scrape results to match single scrape format exactly
    const data = response.data?.map((item) => {
      const metadata = item.metadata ?? {};
      
      return {
        markdown: item.markdown ?? '',
        html: item.html,
        metadata: {
          // Explicitly map known fields (same as single scrape)
          title: metadata.title,
          description: metadata.description,
          ogImage: metadata.ogImage,
          sourceURL: metadata.sourceURL ?? '',
          statusCode: metadata.statusCode ?? 200,
          language: typeof metadata.language === 'string' ? metadata.language : undefined,
          // Preserve all other metadata fields (same as single scrape)
          ...Object.fromEntries(
            Object.entries(metadata).filter(([key]) => 
              !['title', 'description', 'ogImage', 'sourceURL', 'statusCode', 'language'].includes(key)
            )
          ),
        },
      };
    });

    return {
      success: true,
      id: jobId,
      status: response.status,
      completed: response.completed ?? 0,
      total: response.total ?? 0,
      data,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ jobId, error: message }, 'Failed to check batch status');
    return {
      success: false,
      id: jobId,
      status: 'failed',
      completed: 0,
      total: 0,
      error: message,
    };
  }
}

/**
 * Wait for batch scrape to complete with polling
 *
 * @param jobId - The batch job ID
 * @param options - Polling configuration
 */
export async function batchScrapeWait(
  jobId: string,
  options?: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onProgress?: (completed: number, total: number) => void;
  }
): Promise<FireCrawlBatchResult> {
  const pollInterval = options?.pollIntervalMs ?? 5000;
  const maxWait = options?.maxWaitMs ?? 600000; // 10 minutes default
  const startTime = Date.now();

  log.info({ jobId, pollInterval, maxWait }, 'Waiting for batch completion');

  while (Date.now() - startTime < maxWait) {
    try {
      const status = await batchScrapeStatus(jobId);

      // Check if status check failed
      if (!status.success) {
        log.error({ jobId, error: status.error }, 'Status check failed');
        return status;
      }

      // Check if batch is complete or failed
      if (status.status === 'completed' || status.status === 'failed') {
        log.info(
          { jobId, status: status.status, completed: status.completed, total: status.total },
          'Batch finished'
        );
        return status;
      }

      // Progress callback
      if (options?.onProgress && status.total > 0) {
        options.onProgress(status.completed, status.total);
      }

      // Log progress every 30 seconds (6 polls at 5s interval)
      const elapsed = Date.now() - startTime;
      if (elapsed % 30000 < pollInterval) {
        log.info(
          { 
            jobId, 
            completed: status.completed, 
            total: status.total,
            elapsed: Math.round(elapsed / 1000) + 's',
            progress: status.total > 0 ? Math.round((status.completed / status.total) * 100) + '%' : '0%'
          },
          'Batch in progress'
        );
      } else {
        log.debug(
          { jobId, completed: status.completed, total: status.total },
          'Batch in progress'
        );
      }

      await sleep(pollInterval);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error({ jobId, error: message }, 'Error during batch status check');
      return {
        success: false,
        id: jobId,
        status: 'failed',
        completed: 0,
        total: 0,
        error: `Status check error: ${message}`,
      };
    }
  }

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  log.error({ jobId, elapsed: elapsed + 's' }, 'Batch timed out');
  return {
    success: false,
    id: jobId,
    status: 'failed',
    completed: 0,
    total: 0,
    error: `Batch scrape timed out after ${elapsed} seconds`,
  };
}

/**
 * Batch scrape URLs and wait for completion
 * Convenience function that starts a batch and waits for it to finish
 *
 * @param urls - Array of URLs to scrape
 * @param options - Configuration options
 */
export async function batchScrapeAndWait(
  urls: string[],
  options?: {
    formats?: ('markdown' | 'html')[];
    onlyMainContent?: boolean;
    onProgress?: (completed: number, total: number) => void;
    pollIntervalMs?: number;
    maxWaitMs?: number;
  }
): Promise<FireCrawlBatchResult> {
  const startResult = await batchScrapeStart(urls, {
    formats: options?.formats,
    onlyMainContent: options?.onlyMainContent,
  });

  if (!startResult.success) {
    return {
      success: false,
      id: '',
      status: 'failed',
      completed: 0,
      total: urls.length,
      error: startResult.error,
    };
  }

  return batchScrapeWait(startResult.jobId, {
    onProgress: options?.onProgress,
    pollIntervalMs: options?.pollIntervalMs,
    maxWaitMs: options?.maxWaitMs,
  });
}

/**
 * Cancel a batch scrape job
 * DELETE /v2/batch/scrape/{id}
 */
export async function batchScrapeCancel(jobId: string): Promise<{ success: boolean; error?: string }> {
  try {
    await firecrawlRequest(`/batch/scrape/${jobId}`, { method: 'DELETE' });
    log.info({ jobId }, 'Batch scrape cancelled');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    log.error({ jobId, error: message }, 'Failed to cancel batch');
    return { success: false, error: message };
  }
}

// Helper
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
