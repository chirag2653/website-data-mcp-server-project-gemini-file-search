/**
 * Indexing service
 * Handles uploading stored markdown content to Gemini File Search
 * This is separate from ingestion (scraping) to allow retries without re-scraping
 */
import type { SyncError } from '../types/index.js';
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
export declare function indexWebsite(websiteId: string, options?: {
    ingestionJobId?: string;
    syncJobId?: string;
    autoCreateStore?: boolean;
}): Promise<IndexingResult>;
//# sourceMappingURL=indexing.d.ts.map