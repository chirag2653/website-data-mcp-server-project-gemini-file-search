-- Migration: Add 'ready_for_re_indexing' status to page_status enum
-- This status indicates that content has changed significantly and requires:
-- 1. Delete old Gemini document (using existing gemini_file_id)
-- 2. Upload new content to Gemini
-- 3. Update page with new gemini_file_id
--
-- Unlike 'ready_for_indexing' (for new pages), this status is for pages that
-- already have a gemini_file_id but need to be re-indexed due to content changes

-- ============================================================================
-- Add new enum value
-- ============================================================================

ALTER TYPE page_status ADD VALUE IF NOT EXISTS 'ready_for_re_indexing';

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON TYPE page_status IS 'Page lifecycle status: pending → ready_for_indexing (new) → processing → active | ready_for_re_indexing (update) → processing → active';

