-- Website Data MCP Server Schema
-- Comprehensive schema for FireCrawl + Gemini File Search integration
-- Run this in your Supabase SQL Editor

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- Enum Types
-- ============================================================================

CREATE TYPE page_status AS ENUM ('pending', 'processing', 'active', 'deleted', 'redirect', 'error');
CREATE TYPE sync_status AS ENUM ('running', 'completed', 'failed');
CREATE TYPE sync_type AS ENUM ('full', 'incremental', 'manual');
CREATE TYPE gemini_document_state AS ENUM ('PROCESSING', 'ACTIVE', 'FAILED');

-- ============================================================================
-- Websites Table: Primary site configuration
-- ============================================================================

CREATE TABLE websites (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    seed_url TEXT NOT NULL,
    domain TEXT NOT NULL,
    display_name TEXT NOT NULL,
    
    -- Gemini File Search Store information
    gemini_store_id TEXT,  -- Full store name: "fileSearchStores/{store-id}"
    gemini_store_name TEXT,  -- Display name of the store
    
    -- Crawl configuration
    last_full_crawl TIMESTAMPTZ,
    crawl_interval_hours INTEGER DEFAULT 12,
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- Pages Table: Tracks all discovered URLs and their indexing state
-- ============================================================================

CREATE TABLE pages (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    
    -- URL information
    url TEXT NOT NULL,
    path TEXT,  -- Extracted path from URL for filtering
    
    -- Page metadata
    title TEXT,
    status page_status DEFAULT 'pending',
    
    -- Content tracking
    content_hash TEXT,  -- SHA256 hash of markdown content for change detection
    markdown_content TEXT,  -- Stored markdown content (for retry logic and avoiding wasted FireCrawl credits)
    last_scraped TIMESTAMPTZ,  -- When we last successfully scraped this URL
    last_seen TIMESTAMPTZ,  -- When this URL was last seen in FireCrawl map
    firecrawl_scrape_count INTEGER DEFAULT 0,  -- Number of times we've scraped this URL (to avoid wasting credits)
    
    -- HTTP status tracking
    http_status_code INTEGER,  -- Last HTTP status code from FireCrawl (200, 404, 410, etc.)
    
    -- Gemini File Search document information
    -- CRITICAL: gemini_file_id is the full document name needed for deletion
    -- Format: "fileSearchStores/{store-id}/documents/{document-id}"
    gemini_file_id TEXT,  -- Full document resource name for fileSearchStores.documents.delete()
    gemini_file_name TEXT,  -- Display name of the document
    gemini_document_state gemini_document_state,  -- Document processing state (PROCESSING/ACTIVE/FAILED)
    gemini_document_size_bytes BIGINT,  -- Size of document in bytes
    gemini_document_created_at TIMESTAMPTZ,  -- When document was created in Gemini
    
    -- Deletion tracking
    missing_count INTEGER DEFAULT 0,  -- Consecutive syncs where URL was not found (for threshold-based deletion)
    
    -- Error tracking
    error_message TEXT,
    
    -- Flexible metadata storage (JSONB for FireCrawl metadata)
    -- Stores: title, description, og_image, language, and any other FireCrawl metadata
    metadata JSONB DEFAULT '{}',
    
    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Constraints
    UNIQUE(website_id, url)
);

-- ============================================================================
-- Sync Logs Table: Audit trail for sync operations
-- ============================================================================

CREATE TABLE sync_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    website_id UUID NOT NULL REFERENCES websites(id) ON DELETE CASCADE,
    
    -- Sync metadata
    sync_type sync_type NOT NULL,
    status sync_status DEFAULT 'running',
    
    -- Timestamps
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    
    -- Statistics
    urls_discovered INTEGER DEFAULT 0,
    urls_updated INTEGER DEFAULT 0,
    urls_deleted INTEGER DEFAULT 0,
    urls_errored INTEGER DEFAULT 0,
    
    -- Error details
    errors JSONB DEFAULT '[]'  -- Array of {url, error, timestamp} objects
);

-- ============================================================================
-- Indexes for Performance
-- ============================================================================

-- Pages table indexes
CREATE INDEX idx_pages_website_status ON pages(website_id, status);
CREATE INDEX idx_pages_url ON pages(url);
CREATE INDEX idx_pages_last_seen ON pages(last_seen);
CREATE INDEX idx_pages_content_hash ON pages(content_hash);
CREATE INDEX idx_pages_gemini_file ON pages(gemini_file_id);
CREATE INDEX idx_pages_missing_count ON pages(missing_count);  -- For threshold-based deletion queries
CREATE INDEX idx_pages_http_status ON pages(http_status_code);  -- For filtering by status code
CREATE INDEX idx_pages_website_url ON pages(website_id, url);  -- Composite for common lookups

-- Sync logs indexes
CREATE INDEX idx_sync_logs_website ON sync_logs(website_id);
CREATE INDEX idx_sync_logs_status ON sync_logs(status);
CREATE INDEX idx_sync_logs_started_at ON sync_logs(started_at DESC);  -- For history queries

-- Websites indexes
CREATE INDEX idx_websites_domain ON websites(domain);
CREATE INDEX idx_websites_gemini_store ON websites(gemini_store_id);  -- For store lookups

-- ============================================================================
-- Updated_at Trigger Function
-- ============================================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER update_websites_updated_at
    BEFORE UPDATE ON websites
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_pages_updated_at
    BEFORE UPDATE ON pages
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================================================
-- Row Level Security (RLS) - Enable if needed
-- ============================================================================

-- Uncomment these if you want to enable RLS policies
-- ALTER TABLE websites ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE pages ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE sync_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TABLE websites IS 'Primary website configuration and Gemini File Search store mapping';
COMMENT ON TABLE pages IS 'All discovered URLs with their indexing status, content hashes, and Gemini document references';
COMMENT ON TABLE sync_logs IS 'Audit trail for crawl and sync operations';

-- Column comments
COMMENT ON COLUMN pages.content_hash IS 'SHA256 hash of normalized markdown content for change detection';
COMMENT ON COLUMN pages.markdown_content IS 'Stored markdown content for retry logic - allows retrying Gemini uploads without re-scraping';
COMMENT ON COLUMN pages.firecrawl_scrape_count IS 'Number of times this URL has been scraped - helps track FireCrawl credit usage';
COMMENT ON COLUMN pages.missing_count IS 'Consecutive crawls where URL was not found - used for threshold-based deletion (default: 3)';
COMMENT ON COLUMN pages.gemini_file_id IS 'Full document resource name for fileSearchStores.documents.delete() - format: "fileSearchStores/{store}/documents/{document}"';
COMMENT ON COLUMN pages.gemini_document_state IS 'Current state of document in Gemini (PROCESSING/ACTIVE/FAILED)';
COMMENT ON COLUMN pages.http_status_code IS 'Last HTTP status code from FireCrawl scrape (200, 404, 410, etc.)';
COMMENT ON COLUMN pages.metadata IS 'JSONB storage for FireCrawl metadata: title, description, og_image, language, and other fields';
COMMENT ON COLUMN websites.gemini_store_id IS 'Full Gemini File Search store name: "fileSearchStores/{store-id}"';
