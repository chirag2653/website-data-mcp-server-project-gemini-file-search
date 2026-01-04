/**
 * TypeScript type definitions for Website Data MCP Server
 */

// ============================================================================
// Database Types (matching Supabase schema)
// ============================================================================

export type PageStatus = 'pending' | 'ready_for_indexing' | 'ready_for_re_indexing' | 'ready_for_deletion' | 'processing' | 'active' | 'deleted' | 'redirect' | 'error';
export type SyncStatus = 'running' | 'completed' | 'failed';
export type SyncType = 'full' | 'incremental' | 'manual';
export type ProcessType = 'ingestion' | 'indexing' | 'sync' | 'manual_reindex';
export type GeminiDocumentState = 'PROCESSING' | 'ACTIVE' | 'FAILED';

export interface Website {
  id: string;
  seed_url: string;
  domain: string;
  display_name: string;
  gemini_store_id: string | null;
  gemini_store_name: string | null;
  last_full_crawl: string | null;
  crawl_interval_hours: number;
  created_by_ingestion_id: string | null;  // Ingestion process that created this website
  created_at: string;
  updated_at: string;
}

export interface Page {
  id: string;
  website_id: string;
  url: string;
  path: string | null;
  title: string | null;
  status: PageStatus;
  content_hash: string | null;
  markdown_content: string | null;
  last_scraped: string | null;
  last_seen: string | null;
  firecrawl_scrape_count: number;
  http_status_code: number | null;
  gemini_file_id: string | null;
  gemini_file_name: string | null;
  // NOTE: gemini_document_state removed - document states tracked in process_jobs.metadata instead
  // Since indexing is asynchronous, states are tracked in process_jobs, not pages table
  gemini_document_size_bytes: number | null;
  gemini_document_created_at: string | null;
  missing_count: number;
  error_message: string | null;
  metadata: PageMetadata;
  // Lineage tracking - clear separation between ingestion and sync
  created_by_ingestion_id: string | null;  // Ingestion that first created this page
  created_by_sync_id: string | null;  // Sync that first created this page (if added during sync)
  last_updated_by_sync_id: string | null;  // Sync that last updated this page
  firecrawl_batch_id: string | null;  // FireCrawl batch job ID that scraped this page
  created_at: string;
  updated_at: string;
}

export interface PageMetadata {
  title?: string;
  description?: string;
  og_image?: string;
  author?: string;
  published_date?: string;
  [key: string]: unknown;
}

export interface SyncLog {
  id: string;
  website_id: string;
  sync_type: SyncType;
  started_at: string;
  completed_at: string | null;
  urls_discovered: number;
  urls_updated: number;
  urls_deleted: number;
  urls_errored: number;
  errors: SyncError[];
  status: SyncStatus;
}

export interface SyncError {
  url: string;
  error: string;
  timestamp: string;
}

// ============================================================================
// Insert/Update Types (for Supabase operations)
// ============================================================================

export interface WebsiteInsert {
  seed_url: string;
  domain: string;
  display_name: string;
  gemini_store_id?: string;
  gemini_store_name?: string;
  crawl_interval_hours?: number;
  created_by_ingestion_id?: string;  // Ingestion process that creates this website
}

export interface WebsiteUpdate {
  display_name?: string;
  gemini_store_id?: string;
  gemini_store_name?: string;
  last_full_crawl?: string;
  crawl_interval_hours?: number;
  created_by_ingestion_id?: string;  // Ingestion process that created this website
}

export interface PageInsert {
  website_id: string;
  url: string;
  path?: string;
  title?: string;
  status?: PageStatus;
  content_hash?: string;
  markdown_content?: string;  // Include markdown in initial insert to avoid two-step process
  gemini_file_id?: string;
  gemini_file_name?: string;
  metadata?: PageMetadata;
  // Lineage tracking - clear separation
  created_by_ingestion_id?: string;  // If created during ingestion
  created_by_sync_id?: string;  // If created during sync
  firecrawl_batch_id?: string;  // FireCrawl batch that scraped this page
  // Additional fields that can be set during insert
  http_status_code?: number | null;
  firecrawl_scrape_count?: number;
  last_seen?: string;
}

export interface PageUpdate {
  title?: string;
  status?: PageStatus;
  content_hash?: string;
  markdown_content?: string | null;
  last_scraped?: string;
  last_seen?: string;
  firecrawl_scrape_count?: number;
  http_status_code?: number | null;
  gemini_file_id?: string;
  gemini_file_name?: string;
  // NOTE: gemini_document_state removed - document states tracked in process_jobs.metadata instead
  // Since indexing is asynchronous, states are tracked in process_jobs, not pages table
  gemini_document_size_bytes?: number | null;
  gemini_document_created_at?: string | null;
  missing_count?: number;
  error_message?: string | null;
  metadata?: PageMetadata;
  // Lineage tracking - clear separation
  last_updated_by_sync_id?: string;  // Sync that last updated this page
  firecrawl_batch_id?: string;  // FireCrawl batch that scraped this page
}

// SyncLogInsert and SyncLogUpdate removed - replaced by ProcessJobInsert and ProcessJobUpdate

// ============================================================================
// Process Job Types (Lineage Tracking)
// ============================================================================

export interface ProcessJob {
  id: string;
  website_id: string;
  process_type: ProcessType;
  status: SyncStatus;
  started_at: string;
  completed_at: string | null;
  urls_discovered: number;
  urls_updated: number;
  urls_deleted: number;
  urls_errored: number;
  firecrawl_batch_ids: string[];
  errors: SyncError[];
  metadata: Record<string, unknown>;
}

export interface ProcessJobInsert {
  website_id: string;
  process_type: ProcessType;
  status?: SyncStatus;
  firecrawl_batch_ids?: string[];
  metadata?: Record<string, unknown>;
}

export interface ProcessJobUpdate {
  completed_at?: string;
  urls_discovered?: number;
  urls_updated?: number;
  urls_deleted?: number;
  urls_errored?: number;
  firecrawl_batch_ids?: string[];
  errors?: SyncError[];
  status?: SyncStatus;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// FireCrawl Types
// ============================================================================

export interface FireCrawlMapResult {
  success: boolean;
  links: string[];
  error?: string;
}

export interface FireCrawlScrapeResult {
  success: boolean;
  data?: {
    markdown: string;
    html?: string;
    metadata: {
      title?: string;
      description?: string;
      ogImage?: string;
      sourceURL: string;
      statusCode: number;
      language?: string;
      [key: string]: unknown; // Allow other metadata fields
    };
  };
  error?: string;
}

export interface FireCrawlBatchResult {
  success: boolean;
  id: string;
  status: 'scraping' | 'completed' | 'failed';
  completed: number;
  total: number;
  data?: FireCrawlScrapeResult['data'][];
  error?: string;
}

// ============================================================================
// Gemini File Search Types
// ============================================================================

export interface GeminiFileSearchStore {
  name: string;
  displayName: string;
  createTime?: string;
  updateTime?: string;
  activeDocumentsCount?: string;
  pendingDocumentsCount?: string;
  failedDocumentsCount?: string;
  sizeBytes?: string;
}

export interface GeminiFileUploadResult {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  state: 'PROCESSING' | 'ACTIVE' | 'FAILED';
}

export interface GeminiSearchResponse {
  answer: string;
  sources: GeminiCitation[];
  groundingMetadata?: {
    groundingChunks?: Array<{
      chunk: {
        content: string;
      };
      retrievedContext?: {
        uri: string;
        title: string;
      };
    }>;
  };
}

export interface GeminiCitation {
  uri?: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface GeminiFileMetadata {
  url: string;
  title: string;
  path: string;
  lastUpdated: string;
}

// ============================================================================
// Service Types
// ============================================================================

export interface IngestionResult {
  websiteId: string;
  domain: string;
  geminiStoreId: string;
  pagesDiscovered: number;
  pagesIndexed: number;
  errors: SyncError[];
  ingestionJobId?: string; // Optional: Job ID for polling progress
}

export interface SyncResult {
  syncLogId: string;
  urlsDiscovered: number;
  urlsUpdated: number;
  urlsDeleted: number;
  urlsErrored: number;
  errors: SyncError[];
}

export interface SearchResult {
  answer: string;
  sources: Array<{
    url: string;
    title: string;
    snippet?: string;
  }>;
  websiteId: string;
}

export interface UrlStatusResult {
  url: string;
  status: PageStatus;
  lastScraped: string | null;
  lastSeen: string | null;
  contentHash: string | null;
  error: string | null;
  found: boolean;
}

export interface ReindexResult {
  success: boolean;
  url: string;
  contentChanged: boolean;
  previousHash: string | null;
  newHash: string;
  message: string;
}

// ============================================================================
// MCP Tool Input Types
// ============================================================================

export interface SiteAskInput {
  question: string;
  websiteId?: string;
}

export interface SiteCheckInput {
  query: string;
  websiteId?: string;
}

export interface SiteStatusInput {
  url: string;
}

export interface SiteReindexInput {
  url: string;
}

export interface SiteIngestInput {
  seedUrl: string;
  displayName?: string;
}

// ============================================================================
// Configuration Types
// ============================================================================

export interface AppConfig {
  supabase: {
    url: string;
    serviceKey: string;
  };
  gemini: {
    apiKey: string;
    model: string;
  };
  firecrawl: {
    apiKey: string;
  };
  sync: {
    intervalHours: number;
    deletionThreshold: number;
    similarityThreshold: number; // Minimum similarity (0-1) to consider content unchanged
  };
  logging: {
    level: string;
  };
}
