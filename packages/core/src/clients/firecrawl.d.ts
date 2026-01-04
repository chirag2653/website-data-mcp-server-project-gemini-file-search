/**
 * FireCrawl client using direct API calls
 * Based on: https://docs.firecrawl.dev/api-reference
 */
import type { FireCrawlMapResult, FireCrawlScrapeResult, FireCrawlBatchResult } from '../types/index.js';
/**
 * Discover all URLs on a website using FireCrawl's map endpoint
 *
 * @param seedUrl - The starting URL to map from
 * @param options - Optional configuration
 */
export declare function mapWebsite(seedUrl: string, options?: {
    search?: string;
    includeSubdomains?: boolean;
    limit?: number;
    timeout?: number;
}): Promise<FireCrawlMapResult>;
/**
 * Scrape a single URL
 *
 * @param url - The URL to scrape
 * @param options - Optional configuration
 */
export declare function scrapeUrl(url: string, options?: {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    includeTags?: string[];
    excludeTags?: string[];
    waitFor?: number;
    timeout?: number;
}): Promise<FireCrawlScrapeResult>;
/**
 * Start a batch scrape job for multiple URLs
 * Returns immediately with a job ID that can be polled
 *
 * @param urls - Array of URLs to scrape
 * @param options - Optional configuration
 */
export declare function batchScrapeStart(urls: string[], options?: {
    formats?: ('markdown' | 'html' | 'rawHtml' | 'links' | 'screenshot')[];
    onlyMainContent?: boolean;
    maxConcurrency?: number;
    ignoreInvalidURLs?: boolean;
}): Promise<{
    success: true;
    jobId: string;
} | {
    success: false;
    error: string;
}>;
/**
 * Check batch scrape job status
 * GET /v2/batch/scrape/{id}
 *
 * @param jobId - The batch job ID
 */
export declare function batchScrapeStatus(jobId: string): Promise<FireCrawlBatchResult>;
/**
 * Wait for batch scrape to complete with polling
 *
 * @param jobId - The batch job ID
 * @param options - Polling configuration
 */
export declare function batchScrapeWait(jobId: string, options?: {
    pollIntervalMs?: number;
    maxWaitMs?: number;
    onProgress?: (completed: number, total: number) => void;
}): Promise<FireCrawlBatchResult>;
/**
 * Batch scrape URLs and wait for completion
 * Convenience function that starts a batch and waits for it to finish
 *
 * @param urls - Array of URLs to scrape
 * @param options - Configuration options
 */
export declare function batchScrapeAndWait(urls: string[], options?: {
    formats?: ('markdown' | 'html')[];
    onlyMainContent?: boolean;
    onProgress?: (completed: number, total: number) => void;
    pollIntervalMs?: number;
    maxWaitMs?: number;
}): Promise<FireCrawlBatchResult>;
/**
 * Cancel a batch scrape job
 * DELETE /v2/batch/scrape/{id}
 */
export declare function batchScrapeCancel(jobId: string): Promise<{
    success: boolean;
    error?: string;
}>;
//# sourceMappingURL=firecrawl.d.ts.map