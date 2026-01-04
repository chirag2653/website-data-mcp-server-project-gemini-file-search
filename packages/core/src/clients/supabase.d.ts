/**
 * Supabase client for database operations
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { Website, WebsiteInsert, WebsiteUpdate, Page, PageInsert, PageUpdate, ProcessJob, ProcessJobInsert, ProcessJobUpdate, PageStatus } from '../types/index.js';
declare const supabase: SupabaseClient;
export declare function createWebsite(data: WebsiteInsert): Promise<Website>;
export declare function getWebsiteById(id: string): Promise<Website | null>;
/**
 * Get website by exact domain match
 */
export declare function getWebsiteByDomain(domain: string): Promise<Website | null>;
export declare function getAllWebsites(): Promise<Website[]>;
export declare function updateWebsite(id: string, data: WebsiteUpdate): Promise<Website>;
export declare function deleteWebsite(id: string): Promise<void>;
export declare function createPage(data: PageInsert): Promise<Page>;
export declare function upsertPage(data: PageInsert): Promise<Page>;
export declare function createPages(pages: PageInsert[]): Promise<Page[]>;
export declare function upsertPages(pages: PageInsert[]): Promise<Page[]>;
export declare function getPageById(id: string): Promise<Page | null>;
export declare function getPageByUrl(url: string): Promise<Page | null>;
export declare function getPagesByWebsite(websiteId: string, status?: PageStatus): Promise<Page[]>;
export declare function getActivePages(websiteId: string): Promise<Page[]>;
export declare function getPendingPages(websiteId: string): Promise<Page[]>;
/**
 * Get pages by multiple statuses (for retry logic)
 */
export declare function getPagesByStatuses(websiteId: string, statuses: PageStatus[]): Promise<Page[]>;
/**
 * Get pages ready for Gemini indexing
 * Returns pages with status='processing' that have markdown_content but no gemini_file_id
 * Optionally filter by process_job_id (ingestion or sync job)
 */
/**
 * Get pages that are ready for indexing
 *
 * Criteria:
 * - status = 'ready_for_indexing' (set by ingestion/sync after scraping)
 * - markdown_content is not null (content has been scraped)
 * - gemini_file_id is null (not yet indexed in Gemini)
 *
 * These are pages that have been scraped by ingestion/sync and are waiting to be indexed.
 */
export declare function getPagesReadyForIndexing(websiteId: string, options?: {
    processJobId?: string;
    limit?: number;
}): Promise<Page[]>;
export declare function updatePage(id: string, data: PageUpdate): Promise<Page>;
export declare function updatePageByUrl(url: string, data: PageUpdate): Promise<Page | null>;
export declare function updatePagesLastSeen(websiteId: string, urls: string[], timestamp: string): Promise<void>;
export declare function incrementMissingCount(websiteId: string, urls: string[]): Promise<void>;
export declare function getPagesPastDeletionThreshold(websiteId: string, threshold: number): Promise<Page[]>;
export declare function markPagesDeleted(pageIds: string[]): Promise<void>;
export declare function deletePage(id: string): Promise<void>;
export declare function createProcessJob(data: ProcessJobInsert): Promise<ProcessJob>;
export declare function updateProcessJob(id: string, data: ProcessJobUpdate): Promise<ProcessJob>;
export declare function getProcessJob(id: string): Promise<ProcessJob | null>;
export declare function getProcessJobs(websiteId: string, options?: {
    processType?: 'ingestion' | 'sync' | 'manual_reindex';
    limit?: number;
}): Promise<ProcessJob[]>;
export { supabase };
//# sourceMappingURL=supabase.d.ts.map