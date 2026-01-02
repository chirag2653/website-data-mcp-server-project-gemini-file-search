#!/usr/bin/env node
/**
 * Comprehensive Ingestion Pipeline Test
 * Tests multiple domains and verifies:
 * - Website registration
 * - Store creation
 * - Page creation (only complete pages)
 * - Incomplete page discarding
 * - Status progression
 * - Process job tracking
 */

import * as ingestion from './dist/services/ingestion.js';
import * as supabase from './dist/clients/supabase.js';

// Test domain - Tilak Mandirwala
const TEST_DOMAINS = [
  {
    url: 'https://www.tilakmandirwala.com/',
    displayName: 'Tilak Mandirwala - Custom Marble Temples',
  },
];

/**
 * Verify database state after ingestion
 */
async function verifyDatabaseState(websiteId, domain) {
  console.log(`\n  📊 Verifying database state for ${domain}...`);
  
  // Get website
  const website = await supabase.getWebsiteById(websiteId);
  if (!website) {
    throw new Error('Website not found in database');
  }
  
  // Get all pages
  const allPages = await supabase.getPagesByWebsite(websiteId);
  
  // Get pages by status
  const activePages = allPages.filter(p => p.status === 'active');
  const processingPages = allPages.filter(p => p.status === 'processing');
  const errorPages = allPages.filter(p => p.status === 'error');
  const pendingPages = allPages.filter(p => p.status === 'pending');
  
  // Check for incomplete pages
  const pagesWithEmptyMarkdown = allPages.filter(
    p => !p.markdown_content || p.markdown_content.trim().length === 0
  );
  const pagesWithoutHash = allPages.filter(p => !p.content_hash);
  const pagesWithoutMetadata = allPages.filter(
    p => !p.metadata || Object.keys(p.metadata).length === 0
  );
  
  // Get process jobs
  const processJobs = await supabase.getProcessJobs(websiteId, {
    processType: 'ingestion',
    limit: 1,
  });
  const ingestionJob = processJobs[0] || null;
  
  // Statistics
  const stats = {
    website: {
      id: website.id,
      domain: website.domain,
      hasStore: !!website.gemini_store_id,
      storeId: website.gemini_store_id,
      storeName: website.gemini_store_name,
    },
    pages: {
      total: allPages.length,
      active: activePages.length,
      processing: processingPages.length,
      error: errorPages.length,
      pending: pendingPages.length,
    },
    completeness: {
      withMarkdown: allPages.filter(p => p.markdown_content && p.markdown_content.trim().length > 0).length,
      withHash: allPages.filter(p => p.content_hash).length,
      withGeminiFile: allPages.filter(p => p.gemini_file_id).length,
    },
    issues: {
      emptyMarkdown: pagesWithEmptyMarkdown.length,
      missingHash: pagesWithoutHash.length,
      missingMetadata: pagesWithoutMetadata.length,
    },
    processJob: ingestionJob ? {
      id: ingestionJob.id,
      status: ingestionJob.status,
      urlsDiscovered: ingestionJob.urls_discovered,
      urlsUpdated: ingestionJob.urls_updated,
      urlsErrored: ingestionJob.urls_errored,
      batchIds: ingestionJob.firecrawl_batch_ids || [],
      hasBatchId: (ingestionJob.firecrawl_batch_ids || []).length > 0,
    } : null,
  };
  
  return stats;
}

/**
 * Print verification results
 */
function printVerificationResults(stats, domain) {
  console.log(`\n  ✅ Verification Results for ${domain}:`);
  console.log(`  ${'='.repeat(60)}`);
  
  // Website info
  console.log(`\n  📌 Website:`);
  console.log(`     ID: ${stats.website.id}`);
  console.log(`     Domain: ${stats.website.domain}`);
  console.log(`     Store ID: ${stats.website.hasStore ? '✅ ' + stats.website.storeId : '❌ Missing'}`);
  console.log(`     Store Name: ${stats.website.storeName || 'N/A'}`);
  
    // Page statistics
    console.log(`\n  📄 Pages (Ingestion writes 'processing', indexing promotes to 'active'):`);
    console.log(`     Total: ${stats.pages.total}`);
    console.log(`     Processing: ${stats.pages.processing} ⏳ (Expected: pages written by ingestion)`);
    console.log(`     Active: ${stats.pages.active} ✅ (Expected: 0 - indexing is separate pipeline)`);
    console.log(`     Error: ${stats.pages.error} ${stats.pages.error > 0 ? '⚠️' : ''}`);
    console.log(`     Pending: ${stats.pages.pending} ${stats.pages.pending > 0 ? '⚠️' : ''}`);
  
    // Completeness
    console.log(`\n  ✅ Completeness (Ingestion Requirements):`);
    console.log(`     With Markdown: ${stats.completeness.withMarkdown}/${stats.pages.total} ✅ (Required)`);
    console.log(`     With Hash: ${stats.completeness.withHash}/${stats.pages.total} ✅ (Required)`);
    console.log(`     With Gemini File: ${stats.completeness.withGeminiFile}/${stats.pages.total} (Indexing adds this - not required for ingestion)`);
  
  // Issues
  if (stats.issues.emptyMarkdown > 0 || stats.issues.missingHash > 0 || stats.issues.missingMetadata > 0) {
    console.log(`\n  ⚠️  Issues Found:`);
    if (stats.issues.emptyMarkdown > 0) {
      console.log(`     ❌ ${stats.issues.emptyMarkdown} pages with empty markdown (should be 0)`);
    }
    if (stats.issues.missingHash > 0) {
      console.log(`     ❌ ${stats.issues.missingHash} pages missing content hash (should be 0)`);
    }
    if (stats.issues.missingMetadata > 0) {
      console.log(`     ⚠️  ${stats.issues.missingMetadata} pages missing metadata`);
    }
  } else {
    console.log(`\n  ✅ No Issues: All pages are complete`);
  }
  
  // Process job
  if (stats.processJob) {
    console.log(`\n  🔄 Process Job:`);
    console.log(`     Status: ${stats.processJob.status}`);
    console.log(`     URLs Discovered: ${stats.processJob.urlsDiscovered}`);
    console.log(`     URLs Updated: ${stats.processJob.urlsUpdated}`);
    console.log(`     URLs Errored: ${stats.processJob.urlsErrored}`);
    console.log(`     Batch IDs: ${stats.processJob.batchIds.length > 0 ? '✅ ' + stats.processJob.batchIds.join(', ') : '❌ Missing'}`);
  }
  
  // Validation (Ingestion-specific)
  console.log(`\n  🔍 Ingestion Validation:`);
  const validations = {
    hasStore: stats.website.hasStore,
    noEmptyMarkdown: stats.issues.emptyMarkdown === 0,
    noMissingHash: stats.issues.missingHash === 0,
    hasBatchId: stats.processJob?.hasBatchId || false,
    pagesWritten: stats.pages.total > 0,
    pagesProcessing: stats.pages.processing > 0, // Ingestion writes 'processing'
    ingestionCompleted: stats.processJob?.status === 'completed',
  };
  
  Object.entries(validations).forEach(([key, passed]) => {
    console.log(`     ${passed ? '✅' : '❌'} ${key}: ${passed ? 'PASS' : 'FAIL'}`);
  });
  
  return validations;
}

/**
 * Main test function
 */
async function runTests() {
  console.log('🧪 Ingestion Pipeline Test Suite\n');
  console.log('='.repeat(70));
  console.log(`Testing ${TEST_DOMAINS.length} domain(s)`);
  console.log('='.repeat(70));
  
  const results = [];
  
  for (let i = 0; i < TEST_DOMAINS.length; i++) {
    const testDomain = TEST_DOMAINS[i];
    console.log(`\n\n${'='.repeat(70)}`);
    console.log(`Test ${i + 1}/${TEST_DOMAINS.length}: ${testDomain.url}`);
    console.log(`${'='.repeat(70)}`);
    
    try {
      const startTime = Date.now();
      
      // Run ingestion
      console.log(`\n  🚀 Starting ingestion...`);
      const result = await ingestion.ingestWebsite(testDomain.url, testDomain.displayName);
      
      const duration = (Date.now() - startTime) / 1000;
      
      console.log(`\n  ✅ Ingestion completed in ${duration.toFixed(2)}s`);
      console.log(`     Website ID: ${result.websiteId}`);
      console.log(`     Domain: ${result.domain}`);
      console.log(`     Pages Discovered: ${result.pagesDiscovered}`);
      console.log(`     Pages Indexed: ${result.pagesIndexed}`);
      console.log(`     Errors: ${result.errors.length}`);
      
      // Note: Ingestion ends after triggering indexing pipeline
      // Indexing is a separate pipeline that runs after ingestion
      // We don't wait for indexing - that's a separate test
      console.log(`\n  ℹ️  Note: Ingestion complete. Indexing pipeline was triggered (separate process).`);
      
      // Verify database state
      const stats = await verifyDatabaseState(result.websiteId, testDomain.url);
      const validations = printVerificationResults(stats, testDomain.url);
      
      results.push({
        domain: testDomain.url,
        websiteId: result.websiteId,
        success: true,
        stats,
        validations,
        duration,
      });
      
    } catch (error) {
      console.error(`\n  ❌ Test failed for ${testDomain.url}:`);
      console.error(`     ${error.message}`);
      if (error.stack) {
        console.error(`\n     Stack trace:`);
        console.error(error.stack);
      }
      
      results.push({
        domain: testDomain.url,
        success: false,
        error: error.message,
      });
    }
  }
  
  // Summary
  console.log(`\n\n${'='.repeat(70)}`);
  console.log('📊 Test Summary');
  console.log('='.repeat(70));
  
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  
  console.log(`\n  Total Tests: ${results.length}`);
  console.log(`  ✅ Passed: ${successful.length}`);
  console.log(`  ❌ Failed: ${failed.length}`);
  
  if (successful.length > 0) {
    console.log(`\n  ✅ Successful Tests:`);
    successful.forEach((result, i) => {
      console.log(`\n  ${i + 1}. ${result.domain}`);
      console.log(`     Website ID: ${result.websiteId}`);
      console.log(`     Store Created: ${result.stats.website.hasStore ? '✅' : '❌'}`);
      console.log(`     Pages Written: ${result.stats.pages.total}`);
      console.log(`     Processing Pages: ${result.stats.pages.processing} (Ingestion writes 'processing')`);
      console.log(`     Active Pages: ${result.stats.pages.active} (Indexing promotes to 'active' - separate pipeline)`);
      console.log(`     Empty Markdown: ${result.stats.issues.emptyMarkdown} (should be 0)`);
      console.log(`     Duration: ${result.duration.toFixed(2)}s`);
    });
  }
  
  if (failed.length > 0) {
    console.log(`\n  ❌ Failed Tests:`);
    failed.forEach((result, i) => {
      console.log(`  ${i + 1}. ${result.domain}: ${result.error}`);
    });
  }
  
  // Overall validation (Ingestion-specific)
  console.log(`\n  🔍 Overall Ingestion Validation:`);
  const allValidations = successful.map(r => r.validations);
  const overall = {
    allHaveStores: allValidations.every(v => v.hasStore),
    noEmptyMarkdown: allValidations.every(v => v.noEmptyMarkdown),
    noMissingHash: allValidations.every(v => v.noMissingHash),
    allHaveBatchIds: allValidations.every(v => v.hasBatchId),
    allHavePages: allValidations.every(v => v.pagesWritten),
    allHaveProcessingPages: allValidations.every(v => v.pagesProcessing),
    allIngestionsCompleted: allValidations.every(v => v.ingestionCompleted),
  };
  
  Object.entries(overall).forEach(([key, passed]) => {
    console.log(`     ${passed ? '✅' : '❌'} ${key}: ${passed ? 'PASS' : 'FAIL'}`);
  });
  
  console.log(`\n${'='.repeat(70)}\n`);
}

// Run tests
runTests().catch((error) => {
  console.error('\n❌ Test suite failed:');
  console.error(error);
  process.exit(1);
});

