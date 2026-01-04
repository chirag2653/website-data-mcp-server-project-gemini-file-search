'use server';

import * as ingestionService from '../../src/services/ingestion.js';
import * as indexingService from '../../src/services/indexing.js';
import * as supabase from '../../src/clients/supabase.js';
import type { IngestionResult } from '../../src/types/index.js';

/**
 * Server action to check if a website already exists
 * 
 * IMPORTANT: This function is READ-ONLY. It only checks if a website exists.
 * It does NOT create any database records or start any ingestion process.
 * To create a website and start ingestion, use ingestWebsite() instead.
 */
export async function checkWebsite(seedUrl: string) {
  try {
    // Only read operation - checks if website exists in database
    // This does NOT create any records or start any processes
    const result = await ingestionService.checkWebsiteExists(seedUrl);
    return {
      success: true,
      data: result,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Server action to ingest a new website
 * Note: This will block until ingestion completes (can take 10+ minutes)
 * The UI should poll for progress using getIngestionProgress while this runs
 */
export async function ingestWebsite(
  seedUrl: string,
  displayName?: string
): Promise<{
  success: boolean;
  data?: IngestionResult;
  jobId?: string; // Ingestion job ID for polling
  error?: string;
}> {
  try {
    const result = await ingestionService.ingestWebsite(seedUrl, displayName);
    return {
      success: true,
      data: result,
      jobId: result.ingestionJobId, // Job ID for polling progress
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Server action to get ingestion progress by website ID
 * Polls the process_jobs table for the latest ingestion job status
 */
export async function getIngestionProgress(websiteId: string): Promise<{
  success: boolean;
  data?: {
    jobId: string;
    status: 'running' | 'completed' | 'failed';
    progress?: {
      completed: number;
      total: number;
      percentage: number;
    };
    urlsDiscovered?: number;
    urlsUpdated?: number;
    urlsErrored?: number;
    errors?: Array<{ url: string; error: string; timestamp: string }>;
    completedAt?: string;
  };
  error?: string;
}> {
  try {
    // Get latest ingestion job for this website
    const jobs = await supabase.getProcessJobs(websiteId, {
      processType: 'ingestion',
      limit: 1,
    });

    if (jobs.length === 0) {
      return {
        success: false,
        error: 'No ingestion job found for this website',
      };
    }

    const job = jobs[0];
    const metadata = (job.metadata as Record<string, unknown>) || {};
    const progress = metadata.progress as { completed?: number; total?: number; percentage?: number } | undefined;

    return {
      success: true,
      data: {
        jobId: job.id,
        status: job.status,
        progress: progress
          ? {
              completed: progress.completed ?? 0,
              total: progress.total ?? 0,
              percentage: progress.percentage ?? 0,
            }
          : undefined,
        urlsDiscovered: job.urls_discovered ?? undefined,
        urlsUpdated: job.urls_updated ?? undefined,
        urlsErrored: job.urls_errored ?? undefined,
        errors: (job.errors as Array<{ url: string; error: string; timestamp: string }>) ?? undefined,
        completedAt: job.completed_at ?? undefined,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Server action to run indexing for a website
 */
export async function runIndexing(
  websiteId: string,
  ingestionJobId?: string
): Promise<{
  success: boolean;
  data?: {
    websiteId: string;
    pagesIndexed: number;
    errors: Array<{ url: string; error: string; timestamp: string }>;
  };
  error?: string;
}> {
  try {
    const result = await indexingService.indexWebsite(websiteId, {
      ingestionJobId,
    });
    return {
      success: true,
      data: {
        websiteId: result.websiteId,
        pagesIndexed: result.pagesIndexed,
        errors: result.errors,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

