/**
 * Individual URL service
 * Handles individual URL operations: indexing, status checking, and reindexing
 *
 * - Indexing: Add a single URL to an existing website (Service 5)
 * - Status: Get the current status of a URL
 * - Reindex: Force re-scrape and re-index an existing URL
 */
import type { UrlStatusResult, ReindexResult } from '../types/index.js';
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
export declare function indexIndividualUrl(websiteId: string, url: string): Promise<IndividualUrlResult>;
/**
 * Get the current status of a URL
 */
export declare function getUrlStatus(url: string): Promise<UrlStatusResult>;
/**
 * Force re-scrape and re-index a specific URL
 */
export declare function reindexUrl(url: string): Promise<ReindexResult>;
//# sourceMappingURL=individual-url.d.ts.map