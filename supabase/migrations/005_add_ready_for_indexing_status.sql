-- Migration: Add 'ready_for_indexing' status to page_status enum
-- This makes it explicit when pages are ready for indexing vs. currently being processed

-- ============================================================================
-- Add new enum value
-- ============================================================================

ALTER TYPE page_status ADD VALUE IF NOT EXISTS 'ready_for_indexing';

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TYPE page_status IS 'Page lifecycle status: pending → ready_for_indexing → processing → active';

