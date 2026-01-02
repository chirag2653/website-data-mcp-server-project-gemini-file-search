-- Migration: Add Lineage Tracking for Process Jobs and FireCrawl Batches
-- This enables tracking which ingestion/sync run created/updated each page
-- and which FireCrawl batch job was used

-- ============================================================================
-- Process Type Enum
-- ============================================================================

CREATE TYPE process_type AS ENUM ('ingestion', 'indexing', 'sync', 'manual_reindex');

-- ============================================================================
-- Process Jobs Table (Unified tracking for ingestion and sync)
-- ============================================================================

CREATE TABLE process_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    
    -- Process metadata
    process_type process_type NOT NULL,
    status sync_status DEFAULT 'running',  -- Reuse sync_status enum (running/completed/failed)
    
    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Statistics
    urls_discovered INTEGER DEFAULT 0,
    urls_updated INTEGER DEFAULT 0,
    urls_deleted INTEGER DEFAULT 0,
    urls_errored INTEGER DEFAULT 0,
    
    -- FireCrawl batch tracking
    firecrawl_batch_ids TEXT[],  -- Array of FireCrawl batch job IDs used in this process
    
    -- Error details
    errors JSONB DEFAULT '[]',  -- Array of {url, error, timestamp} objects
    
    -- Additional metadata
    metadata JSONB DEFAULT '{}'  -- For storing process-specific metadata
);

-- ============================================================================
-- Add Lineage Columns to Websites Table
-- ============================================================================

ALTER TABLE websites
    ADD COLUMN created_by_ingestion_id UUID REFERENCES process_jobs(id) ON DELETE SET NULL;

-- ============================================================================
-- Add Lineage Columns to Pages Table
-- ============================================================================

ALTER TABLE pages
    ADD COLUMN created_by_ingestion_id UUID REFERENCES process_jobs(id) ON DELETE SET NULL,  -- Ingestion that first created this page
    ADD COLUMN created_by_sync_id UUID REFERENCES process_jobs(id) ON DELETE SET NULL,  -- Sync that first created this page (if added during sync)
    ADD COLUMN last_updated_by_sync_id UUID REFERENCES process_jobs(id) ON DELETE SET NULL,  -- Sync that last updated this page
    ADD COLUMN firecrawl_batch_id TEXT;  -- FireCrawl batch job ID that scraped this page

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Process jobs indexes
CREATE INDEX idx_process_jobs_website ON process_jobs(website_id);
CREATE INDEX idx_process_jobs_type ON process_jobs(process_type);
CREATE INDEX idx_process_jobs_status ON process_jobs(status);
CREATE INDEX idx_process_jobs_started_at ON process_jobs(started_at DESC);
CREATE INDEX idx_process_jobs_website_type ON process_jobs(website_id, process_type);

-- Websites lineage indexes
CREATE INDEX idx_websites_created_by_ingestion ON websites(created_by_ingestion_id);

-- Pages lineage indexes
CREATE INDEX idx_pages_created_by_ingestion ON pages(created_by_ingestion_id);
CREATE INDEX idx_pages_created_by_sync ON pages(created_by_sync_id);
CREATE INDEX idx_pages_updated_by_sync ON pages(last_updated_by_sync_id);
CREATE INDEX idx_pages_firecrawl_batch ON pages(firecrawl_batch_id);

-- ============================================================================
-- Migrate Existing sync_logs to process_jobs
-- ============================================================================

-- Copy existing sync_logs to process_jobs
INSERT INTO process_jobs (
    id,
    website_id,
    process_type,
    status,
    started_at,
    completed_at,
    urls_discovered,
    urls_updated,
    urls_deleted,
    urls_errored,
    errors
)
SELECT 
    id,
    website_id,
    CASE 
        WHEN sync_type = 'full' THEN 'ingestion'::process_type
        ELSE 'sync'::process_type
    END,
    status,
    started_at,
    completed_at,
    urls_discovered,
    urls_updated,
    urls_deleted,
    urls_errored,
    errors
FROM sync_logs;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE process_jobs IS 'Unified tracking for ingestion and sync processes - provides lineage tracking';
COMMENT ON COLUMN process_jobs.process_type IS 'Type of process: ingestion (full crawl), sync (incremental), or manual_reindex';
COMMENT ON COLUMN process_jobs.firecrawl_batch_ids IS 'Array of FireCrawl batch job IDs used during this process';
COMMENT ON COLUMN websites.created_by_ingestion_id IS 'Ingestion process that created this website';
COMMENT ON COLUMN pages.created_by_ingestion_id IS 'Ingestion process that first created this page (if created during initial ingestion)';
COMMENT ON COLUMN pages.created_by_sync_id IS 'Sync process that first created this page (if added during sync)';
COMMENT ON COLUMN pages.last_updated_by_sync_id IS 'Sync process that last updated this page (content, status, etc.)';
COMMENT ON COLUMN pages.firecrawl_batch_id IS 'FireCrawl batch job ID that scraped this page content';

