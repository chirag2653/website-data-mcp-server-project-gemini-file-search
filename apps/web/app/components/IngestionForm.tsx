'use client';

import { useState, useTransition, useEffect, useRef } from 'react';
import { checkWebsite, ingestWebsite, runIndexing, getIngestionProgress } from '../actions/ingestion';
import { StatusDisplay } from './StatusDisplay';
import { UrlInput } from './UrlInput';

export type WebsiteStatus = 
  | { type: 'idle' }
  | { type: 'checking' }
  | { type: 'exists'; website: any; domain: string }
  | { type: 'new'; domain: string }
  | { type: 'ingesting'; websiteId: string; jobId?: string; progress?: { completed: number; total: number; percentage: number } }
  | { type: 'ingested'; result: any; websiteId: string }
  | { type: 'indexing'; websiteId: string }
  | { type: 'indexed'; result: any }
  | { type: 'error'; message: string };

export function IngestionForm() {
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [status, setStatus] = useState<WebsiteStatus>({ type: 'idle' });
  const [isPending, startTransition] = useTransition();
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Poll for ingestion progress when status is 'ingesting'
  useEffect(() => {
    if (status.type === 'ingesting' && status.websiteId) {
      const pollProgress = async () => {
        try {
          const progressResult = await getIngestionProgress(status.websiteId);
          
          if (progressResult.success && progressResult.data) {
            const progressData = progressResult.data;
            
            if (progressData.status === 'completed') {
              // Ingestion completed - stop polling and show success
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              
              // Get final result from the completed job
              setStatus({
                type: 'ingested',
                result: {
                  websiteId: status.websiteId,
                  pagesDiscovered: progressData.urlsDiscovered ?? 0,
                  pagesIndexed: progressData.urlsUpdated ?? 0,
                  errors: progressData.errors ?? [],
                },
                websiteId: status.websiteId,
              });
            } else if (progressData.status === 'failed') {
              // Ingestion failed - stop polling and show error
              if (pollingIntervalRef.current) {
                clearInterval(pollingIntervalRef.current);
                pollingIntervalRef.current = null;
              }
              setStatus({
                type: 'error',
                message: progressData.errors?.[0]?.error || 'Ingestion failed',
              });
            } else if (progressData.status === 'running') {
              // Still running - update progress
              setStatus({
                type: 'ingesting',
                websiteId: status.websiteId,
                jobId: progressData.jobId,
                progress: progressData.progress,
              });
            }
          }
        } catch (error) {
          console.error('Error polling ingestion progress:', error);
          // Don't stop polling on error - might be temporary
        }
      };

      // Poll immediately, then every 5 seconds
      pollProgress();
      pollingIntervalRef.current = setInterval(pollProgress, 5000);
    }

    // Cleanup on unmount or status change
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
        pollingIntervalRef.current = null;
      }
    };
  }, [status]);

  const handleCheck = async () => {
    if (!url.trim()) {
      setStatus({ type: 'error', message: 'Please enter a URL' });
      return;
    }

    setStatus({ type: 'checking' });

    startTransition(async () => {
      const result = await checkWebsite(url);
      
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to check website' });
        return;
      }

      if (result.data?.exists) {
        setStatus({
          type: 'exists',
          website: result.data.website,
          domain: result.data.domain,
        });
      } else {
        setStatus({
          type: 'new',
          domain: result.data?.domain || '',
        });
      }
    });
  };

  const handleIngest = async () => {
    if (!url.trim()) {
      setStatus({ type: 'error', message: 'Please enter a URL' });
      return;
    }

    startTransition(async () => {
      const result = await ingestWebsite(url, displayName || undefined);
      
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to ingest website' });
        return;
      }

      // If we got a job ID, start polling for progress
      if (result.jobId && result.data) {
        setStatus({
          type: 'ingesting',
          websiteId: result.data.websiteId,
          jobId: result.jobId,
        });
      } else if (result.data) {
        // If no job ID but we have data, ingestion completed immediately (recovered job)
        setStatus({
          type: 'ingested',
          result: result.data,
          websiteId: result.data.websiteId,
        });
      } else {
        setStatus({ type: 'error', message: 'Unexpected response from ingestion' });
      }
    });
  };

  const handleIndexing = async (websiteId: string) => {
    setStatus({ type: 'indexing', websiteId });

    startTransition(async () => {
      const result = await runIndexing(websiteId);
      
      if (!result.success) {
        setStatus({ type: 'error', message: result.error || 'Failed to run indexing' });
        return;
      }

      setStatus({
        type: 'indexed',
        result: result.data,
      });
    });
  };

  const handleReset = () => {
    setUrl('');
    setDisplayName('');
    setStatus({ type: 'idle' });
  };

  return (
    <div className="space-y-6">
      <UrlInput
        url={url}
        displayName={displayName}
        onUrlChange={setUrl}
        onDisplayNameChange={setDisplayName}
        onCheck={handleCheck}
        disabled={isPending || status.type === 'checking' || status.type === 'ingesting' || status.type === 'indexing'}
      />

      <StatusDisplay
        status={status}
        onIngest={handleIngest}
        onIndexing={handleIndexing}
        onReset={handleReset}
        isPending={isPending}
      />
    </div>
  );
}

