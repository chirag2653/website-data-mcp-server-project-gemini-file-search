/**
 * Supabase client for database operations
 */
import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';
import { loggers } from '../utils/logger.js';
const log = loggers.supabase;
// Create Supabase client
const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
// ============================================================================
// Website Operations
// ============================================================================
export async function createWebsite(data) {
    log.info({ domain: data.domain }, 'Creating website record');
    const { data: website, error } = await supabase
        .from('websites')
        .insert(data)
        .select()
        .single();
    if (error) {
        log.error({ error, data }, 'Failed to create website');
        throw new Error(`Failed to create website: ${error.message}`);
    }
    log.info({ websiteId: website.id }, 'Website created');
    return website;
}
export async function getWebsiteById(id) {
    const { data, error } = await supabase
        .from('websites')
        .select()
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null; // Not found
        throw new Error(`Failed to get website: ${error.message}`);
    }
    return data;
}
/**
 * Get website by exact domain match
 */
export async function getWebsiteByDomain(domain) {
    const { data, error } = await supabase
        .from('websites')
        .select()
        .eq('domain', domain)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get website by domain: ${error.message}`);
    }
    return data;
}
export async function getAllWebsites() {
    const { data, error } = await supabase
        .from('websites')
        .select()
        .order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Failed to get websites: ${error.message}`);
    }
    return data ?? [];
}
export async function updateWebsite(id, data) {
    const { data: website, error } = await supabase
        .from('websites')
        .update(data)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update website: ${error.message}`);
    }
    return website;
}
export async function deleteWebsite(id) {
    const { error } = await supabase.from('websites').delete().eq('id', id);
    if (error) {
        throw new Error(`Failed to delete website: ${error.message}`);
    }
}
// ============================================================================
// Page Operations
// ============================================================================
export async function createPage(data) {
    const { data: page, error } = await supabase
        .from('pages')
        .insert(data)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to create page: ${error.message}`);
    }
    return page;
}
export async function upsertPage(data) {
    const { data: page, error } = await supabase
        .from('pages')
        // onConflict can use column names for composite unique constraints
        // PostgreSQL auto-generates constraint name, but column names work too
        .upsert(data, { onConflict: 'website_id,url' })
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to upsert page: ${error.message}`);
    }
    return page;
}
export async function createPages(pages) {
    if (pages.length === 0)
        return [];
    log.info({ count: pages.length }, 'Bulk inserting pages');
    const { data, error } = await supabase
        .from('pages')
        .insert(pages)
        .select();
    if (error) {
        throw new Error(`Failed to bulk insert pages: ${error.message}`);
    }
    return data ?? [];
}
export async function upsertPages(pages) {
    if (pages.length === 0)
        return [];
    log.info({ count: pages.length }, 'Bulk upserting pages');
    const { data, error } = await supabase
        .from('pages')
        .upsert(pages, { onConflict: 'website_id,url' })
        .select();
    if (error) {
        throw new Error(`Failed to bulk upsert pages: ${error.message}`);
    }
    return data ?? [];
}
export async function getPageById(id) {
    const { data, error } = await supabase
        .from('pages')
        .select()
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get page: ${error.message}`);
    }
    return data;
}
export async function getPageByUrl(url) {
    const { data, error } = await supabase
        .from('pages')
        .select()
        .eq('url', url)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get page by URL: ${error.message}`);
    }
    return data;
}
export async function getPagesByWebsite(websiteId, status) {
    let query = supabase.from('pages').select().eq('website_id', websiteId);
    if (status) {
        query = query.eq('status', status);
    }
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) {
        throw new Error(`Failed to get pages: ${error.message}`);
    }
    return data ?? [];
}
export async function getActivePages(websiteId) {
    return getPagesByWebsite(websiteId, 'active');
}
export async function getPendingPages(websiteId) {
    return getPagesByWebsite(websiteId, 'pending');
}
/**
 * Get pages by multiple statuses (for retry logic)
 */
export async function getPagesByStatuses(websiteId, statuses) {
    const { data, error } = await supabase
        .from('pages')
        .select()
        .eq('website_id', websiteId)
        .in('status', statuses)
        .order('updated_at', { ascending: true }); // Oldest first for retry
    if (error) {
        throw new Error(`Failed to get pages by statuses: ${error.message}`);
    }
    return data ?? [];
}
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
export async function getPagesReadyForIndexing(websiteId, options) {
    let query = supabase
        .from('pages')
        .select()
        .eq('website_id', websiteId)
        .eq('status', 'ready_for_indexing') // Pages marked as ready for indexing by ingestion/sync
        .not('markdown_content', 'is', null) // Must have scraped content
        .or('gemini_file_id.is.null,gemini_file_id.eq.') // Not yet indexed (no gemini_file_id)
        .order('updated_at', { ascending: true }); // Oldest first (FIFO)
    // Optional: Filter by process job (ingestion or sync)
    // Check if page was created/updated by this process job
    if (options?.processJobId) {
        query = query.or(`created_by_ingestion_id.eq.${options.processJobId},created_by_sync_id.eq.${options.processJobId},last_updated_by_sync_id.eq.${options.processJobId}`);
    }
    if (options?.limit) {
        query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to get pages ready for indexing: ${error.message}`);
    }
    // Additional filter: ensure markdown_content is not empty
    return (data ?? []).filter((page) => page.markdown_content && page.markdown_content.trim().length > 0);
}
export async function updatePage(id, data) {
    const { data: page, error } = await supabase
        .from('pages')
        .update(data)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        throw new Error(`Failed to update page: ${error.message}`);
    }
    return page;
}
export async function updatePageByUrl(url, data) {
    const { data: page, error } = await supabase
        .from('pages')
        .update(data)
        .eq('url', url)
        .select()
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to update page by URL: ${error.message}`);
    }
    return page;
}
export async function updatePagesLastSeen(websiteId, urls, timestamp) {
    if (urls.length === 0)
        return;
    const { error } = await supabase
        .from('pages')
        .update({ last_seen: timestamp, missing_count: 0 })
        .eq('website_id', websiteId)
        .in('url', urls);
    if (error) {
        throw new Error(`Failed to update pages last_seen: ${error.message}`);
    }
}
export async function incrementMissingCount(websiteId, urls) {
    if (urls.length === 0)
        return;
    // Get current pages
    const { data: pages, error: fetchError } = await supabase
        .from('pages')
        .select('id, missing_count')
        .eq('website_id', websiteId)
        .in('url', urls);
    if (fetchError) {
        throw new Error(`Failed to fetch pages: ${fetchError.message}`);
    }
    // Update each page's missing count
    for (const page of pages ?? []) {
        const { error } = await supabase
            .from('pages')
            .update({ missing_count: page.missing_count + 1 })
            .eq('id', page.id);
        if (error) {
            log.error({ pageId: page.id, error }, 'Failed to increment missing count');
        }
    }
}
export async function getPagesPastDeletionThreshold(websiteId, threshold) {
    const { data, error } = await supabase
        .from('pages')
        .select()
        .eq('website_id', websiteId)
        .gte('missing_count', threshold)
        .neq('status', 'deleted');
    if (error) {
        throw new Error(`Failed to get pages past threshold: ${error.message}`);
    }
    return data ?? [];
}
export async function markPagesDeleted(pageIds) {
    if (pageIds.length === 0)
        return;
    const { error } = await supabase
        .from('pages')
        .update({ status: 'deleted' })
        .in('id', pageIds);
    if (error) {
        throw new Error(`Failed to mark pages deleted: ${error.message}`);
    }
}
export async function deletePage(id) {
    const { error } = await supabase.from('pages').delete().eq('id', id);
    if (error) {
        throw new Error(`Failed to delete page: ${error.message}`);
    }
}
// ============================================================================
// Sync Log Operations
// ============================================================================
// ============================================================================
// Process Job Operations (Lineage Tracking)
// ============================================================================
export async function createProcessJob(data) {
    log.info({ websiteId: data.website_id, processType: data.process_type }, 'Creating process job');
    const { data: processJob, error } = await supabase
        .from('process_jobs')
        .insert({
        ...data,
        status: data.status ?? 'running',
        firecrawl_batch_ids: data.firecrawl_batch_ids ?? [],
        metadata: data.metadata ?? {},
    })
        .select()
        .single();
    if (error) {
        log.error({ error, data }, 'Failed to create process job');
        throw new Error(`Failed to create process job: ${error.message}`);
    }
    log.info({ processJobId: processJob.id }, 'Process job created');
    return processJob;
}
export async function updateProcessJob(id, data) {
    const { data: processJob, error } = await supabase
        .from('process_jobs')
        .update(data)
        .eq('id', id)
        .select()
        .single();
    if (error) {
        log.error({ processJobId: id, error }, 'Failed to update process job');
        throw new Error(`Failed to update process job: ${error.message}`);
    }
    return processJob;
}
export async function getProcessJob(id) {
    const { data, error } = await supabase
        .from('process_jobs')
        .select()
        .eq('id', id)
        .single();
    if (error) {
        if (error.code === 'PGRST116')
            return null;
        throw new Error(`Failed to get process job: ${error.message}`);
    }
    return data;
}
export async function getProcessJobs(websiteId, options) {
    let query = supabase
        .from('process_jobs')
        .select()
        .eq('website_id', websiteId);
    if (options?.processType) {
        query = query.eq('process_type', options.processType);
    }
    query = query.order('started_at', { ascending: false });
    if (options?.limit) {
        query = query.limit(options.limit);
    }
    const { data, error } = await query;
    if (error) {
        throw new Error(`Failed to get process jobs: ${error.message}`);
    }
    return data ?? [];
}
// Export client for direct access if needed
export { supabase };
//# sourceMappingURL=supabase.js.map