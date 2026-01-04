-- Migration: Remove gemini_document_state from pages table
-- Document states are now tracked in process_jobs.metadata instead
-- This simplifies the pages table to use only one status field

-- ============================================================================
-- Drop gemini_document_state column from pages table
-- ============================================================================

-- Drop the column (no indexes or constraints to drop first)
ALTER TABLE pages DROP COLUMN IF EXISTS gemini_document_state;

-- ============================================================================
-- Drop the enum type (no longer used anywhere)
-- ============================================================================

-- Drop the enum type if it exists and is not used elsewhere
-- Note: This will fail if the enum is still referenced, but we've verified it's only used in pages.gemini_document_state
DROP TYPE IF EXISTS gemini_document_state;

-- ============================================================================
-- Comments for Documentation
-- ============================================================================

COMMENT ON COLUMN pages.status IS 'Complete page lifecycle: pending → processing → active. Document states (ACTIVE/PROCESSING/FAILED) are tracked in process_jobs.metadata.documentStates';

