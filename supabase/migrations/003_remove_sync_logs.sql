-- Migration: Remove sync_logs table (replaced by process_jobs)
-- process_jobs is a unified table that handles ingestion, indexing, and sync

-- ============================================================================
-- Drop sync_logs table and related objects
-- ============================================================================

-- Drop indexes first
DROP INDEX IF EXISTS idx_sync_logs_website;
DROP INDEX IF EXISTS idx_sync_logs_status;
DROP INDEX IF EXISTS idx_sync_logs_started_at;

-- Drop the table (CASCADE will handle foreign keys)
DROP TABLE IF EXISTS sync_logs CASCADE;

-- Note: sync_type enum is still used elsewhere, so we keep it
-- (It's used in process_jobs metadata if needed)

