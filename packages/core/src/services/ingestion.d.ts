/**
 * Website ingestion service
 * Handles initial crawl and indexing of a website
 */
import * as supabase from '../clients/supabase.js';
import type { IngestionResult, ProcessJob } from '../types/index.js';
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
export declare function checkWebsiteExists(seedUrl: string): Promise<{
    exists: boolean;
    website: Awaited<ReturnType<typeof supabase.getWebsiteById>> | null;
    domain: string;
    action: 'sync' | 'ingest';
}>;
export declare function ingestWebsite(seedUrl: string, displayName?: string): Promise<IngestionResult>;
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
export declare function recoverIngestionJob(ingestionJobId: string): Promise<{
    recovered: boolean;
    status: 'completed' | 'failed' | 'still_running' | 'cannot_recover';
    result?: IngestionResult;
    error?: string;
}>;
/**
 * Get ingestion status for a website
 */
export declare function getIngestionStatus(websiteId: string): Promise<{
    website: NonNullable<Awaited<ReturnType<typeof supabase.getWebsiteById>>>;
    totalPages: number;
    activePages: number;
    pendingPages: number;
    errorPages: number;
    deletedPages: number;
    lastSync: ProcessJob | null;
}>;
/**
 * List all ingested websites
 */
export declare function listWebsites(): Promise<Array<{
    id: string;
    domain: string;
    displayName: string;
    pageCount: number;
    lastCrawl: string | null;
}>>;
//# sourceMappingURL=ingestion.d.ts.map