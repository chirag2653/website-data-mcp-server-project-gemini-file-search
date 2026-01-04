/**
 * Sync service
 * Handles incremental updates and refresh of website content
 */
import type { SyncResult } from '../types/index.js';
/**
 * Perform incremental sync for a website
 *
 * Flow (Phase 1: Categorization):
 * 1. Re-run FireCrawl /map to get current URLs
 * 2. Compare with Supabase to categorize:
 *    - NEW: URL in map but not in DB → scrape + index
 *    - EXISTING: URL in both → scrape and compare hash
 *      - CHANGED: Hash differs → delete old, upload new, update DB
 *      - UNCHANGED: Hash matches → update timestamps, reset missing_count
 *    - MISSING: URL in DB but not in map → increment missing_count
 *    - 404/410: URL returns error → increment missing_count (treat as missing)
 *
 * Flow (Phase 2: Deletion):
 * 3. Only delete URLs where missing_count >= threshold (default: 3)
 *    This prevents false deletions due to temporary issues (site down, network errors, etc.)
 */
export declare function syncWebsite(websiteId: string): Promise<SyncResult>;
/**
 * Get sync history for a website
 */
export declare function getSyncHistory(websiteId: string, limit?: number): Promise<Array<{
    id: string;
    type: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
    urlsDiscovered: number;
    urlsUpdated: number;
    urlsDeleted: number;
    errorCount: number;
}>>;
//# sourceMappingURL=sync.d.ts.map