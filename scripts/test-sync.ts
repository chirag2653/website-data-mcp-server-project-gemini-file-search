#!/usr/bin/env node
/**
 * Direct test script for sync service
 * 
 * This script allows you to test the sync core logic directly
 * without going through Next.js or MCP server.
 * 
 * Usage:
 *   pnpm test:sync <websiteId>
 * 
 * Example:
 *   pnpm test:sync abc123-def456-ghi789
 * 
 * Prerequisites:
 *   1. Website must exist in database (created via ingestion)
 *   2. Website must have at least one page
 *   3. Website must have a Gemini store (created during ingestion)
 * 
 * What it does:
 *   1. Discovers current URLs via FireCrawl /map
 *   2. Compares with database to categorize: NEW, EXISTING, MISSING
 *   3. Scrapes new/changed URLs
 *   4. Compares content using similarity threshold (default: 95%)
 *   5. Marks pages for re-indexing if content changed significantly
 *   6. Increments missing_count for missing URLs
 *   7. Marks pages for deletion if missing_count >= threshold (default: 3)
 *   8. Triggers indexing pipeline (async)
 * 
 * To get a website ID:
 *   - Check your Supabase database: SELECT id, domain FROM websites;
 *   - Or use the ingestion service first to create a website
 */

import * as syncService from '../packages/core/src/services/sync.js';
import * as supabase from '../packages/core/src/clients/supabase.js';
import * as ingestionService from '../packages/core/src/services/ingestion.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('\n❌ Error: Website ID required\n');
    console.log('Usage: pnpm test:sync <websiteId>\n');
    console.log('Example: pnpm test:sync abc123-def456-ghi789\n');
    console.log('To find website IDs, check your Supabase database:');
    console.log('  SELECT id, domain, display_name FROM websites;\n');
    process.exit(1);
  }

  const websiteId = args[0];

  console.log('\n🔄 Testing Sync Service\n');
  console.log(`Website ID: ${websiteId}\n`);

  try {
    // Step 1: Verify website exists
    console.log('Step 1: Verifying website exists...');
    const website = await supabase.getWebsiteById(websiteId);
    
    if (!website) {
      console.error(`❌ Website not found: ${websiteId}`);
      console.log('\nAvailable websites:');
      const websites = await ingestionService.listWebsites();
      if (websites.length === 0) {
        console.log('  (No websites found in database)');
      } else {
        websites.forEach(w => {
          console.log(`  - ${w.id} (${w.domain}) ${w.displayName ? `- ${w.displayName}` : ''}`);
        });
      }
      process.exit(1);
    }

    console.log(`✅ Website found: ${website.domain}${website.display_name ? ` (${website.display_name})` : ''}`);
    console.log(`   Store ID: ${website.gemini_store_id || '(none)'}`);
    console.log(`   Seed URL: ${website.seed_url}\n`);

    // Step 2: Check existing pages
    console.log('Step 2: Checking existing pages...');
    const existingPages = await supabase.getPagesByWebsite(websiteId);
    
    if (existingPages.length === 0) {
      console.error('\n❌ Website has no pages.');
      console.log('\n💡 Tip: Run ingestion first to scrape and register pages:');
      console.log(`   pnpm test:ingestion ${website.seed_url}\n`);
      process.exit(1);
    }

    console.log(`   Found ${existingPages.length} existing pages`);
    
    // Show page status breakdown
    const statusCounts = existingPages.reduce((acc, page) => {
      acc[page.status] = (acc[page.status] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    
    console.log('\n   Page status breakdown:');
    Object.entries(statusCounts).forEach(([status, count]) => {
      console.log(`     - ${status}: ${count}`);
    });

    // Check for pages with missing_count
    const pagesWithMissingCount = existingPages.filter(p => p.missing_count > 0);
    if (pagesWithMissingCount.length > 0) {
      console.log(`\n   Pages with missing_count > 0: ${pagesWithMissingCount.length}`);
      const maxMissing = Math.max(...pagesWithMissingCount.map(p => p.missing_count));
      console.log(`   Max missing_count: ${maxMissing}`);
    }

    if (!website.gemini_store_id) {
      console.error('\n❌ Website has no Gemini store.');
      console.log('💡 Tip: This should have been created during ingestion. Re-run ingestion.\n');
      process.exit(1);
    }

    console.log('\n✅ Prerequisites met\n');

    // Step 3: Run sync
    console.log('Step 3: Running sync service...');
    console.log('(This may take several minutes depending on website size)\n');
    
    const result = await syncService.syncWebsite(websiteId);

    // Step 4: Display results
    console.log('\n✅ Sync Complete!\n');
    console.log('Results:');
    console.log(`  Sync Job ID: ${result.syncLogId}`);
    console.log(`  URLs Discovered: ${result.urlsDiscovered}`);
    console.log(`  URLs Updated: ${result.urlsUpdated}`);
    console.log(`  URLs Deleted: ${result.urlsDeleted}`);
    console.log(`  URLs Errored: ${result.urlsErrored}`);
    
    // Step 5: Fetch and display rich metadata from process job
    console.log('\n📊 Detailed Statistics:');
    try {
      const processJob = await supabase.getProcessJob(result.syncLogId);
      if (processJob?.metadata) {
        const meta = processJob.metadata as any;
        
        if (meta.categorization) {
          console.log('\n  URL Categorization:');
          console.log(`    New URLs: ${meta.categorization.newUrls}`);
          console.log(`    Existing URLs: ${meta.categorization.existingUrls}`);
          console.log(`    Missing URLs: ${meta.categorization.missingUrls}`);
        }
        
        if (meta.contentChanges) {
          console.log('\n  Content Changes:');
          console.log(`    Unchanged: ${meta.contentChanges.unchanged}`);
          console.log(`    Changed: ${meta.contentChanges.changed}`);
          if (meta.contentChanges.emptyContent > 0) {
            console.log(`    Empty Content: ${meta.contentChanges.emptyContent}`);
          }
        }
        
        if (meta.similarity && meta.similarity.pagesCompared > 0) {
          console.log('\n  Content Similarity:');
          console.log(`    Pages Compared: ${meta.similarity.pagesCompared}`);
          if (meta.similarity.average !== null) {
            console.log(`    Average Similarity: ${meta.similarity.average}%`);
          }
          if (meta.similarity.minimum !== null) {
            console.log(`    Minimum Similarity: ${meta.similarity.minimum}%`);
          }
          if (meta.similarity.maximum !== null) {
            console.log(`    Maximum Similarity: ${meta.similarity.maximum}%`);
          }
          console.log(`    Threshold: ${meta.similarity.threshold}%`);
        }
        
        if (meta.errors) {
          const hasErrors = meta.errors.http404 > 0 || meta.errors.http410 > 0 || meta.errors.total > 0;
          if (hasErrors) {
            console.log('\n  Errors:');
            if (meta.errors.http404 > 0) {
              console.log(`    HTTP 404: ${meta.errors.http404}`);
            }
            if (meta.errors.http410 > 0) {
              console.log(`    HTTP 410: ${meta.errors.http410}`);
            }
            if (meta.errors.total > 0) {
              console.log(`    Total Errors: ${meta.errors.total}`);
            }
          }
        }
        
        if (meta.missingCount && meta.missingCount.pagesWithMissingCount > 0) {
          console.log('\n  Missing Count Statistics:');
          console.log(`    Pages with Missing Count: ${meta.missingCount.pagesWithMissingCount}`);
          if (meta.missingCount.average !== null) {
            console.log(`    Average Missing Count (before increment): ${meta.missingCount.average.toFixed(2)}`);
          }
          if (meta.missingCount.maximum !== null) {
            console.log(`    Maximum Missing Count (before increment): ${meta.missingCount.maximum}`);
            console.log(`    → After increment: ${meta.missingCount.maximum + 1}`);
          }
          console.log(`    Deletion Threshold: ${meta.missingCount.deletionThreshold}`);
          if (meta.missingCount.maximum !== null && meta.missingCount.maximum + 1 >= meta.missingCount.deletionThreshold) {
            console.log(`    ⚠️  Pages approaching deletion threshold`);
          }
        }
        
        if (meta.statusChanges) {
          console.log('\n  Status Changes:');
          if (meta.statusChanges.readyForIndexing > 0) {
            console.log(`    Ready for Indexing (new): ${meta.statusChanges.readyForIndexing}`);
          }
          if (meta.statusChanges.readyForReIndexing > 0) {
            console.log(`    Ready for Re-Indexing (changed): ${meta.statusChanges.readyForReIndexing}`);
          }
          if (meta.statusChanges.readyForDeletion > 0) {
            console.log(`    Ready for Deletion: ${meta.statusChanges.readyForDeletion}`);
          }
        }
      }
    } catch (metaError) {
      // Silently fail if metadata can't be retrieved
      console.log('  (Metadata not available)');
    }

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.slice(0, 10).forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.url || 'Unknown'}: ${error.error}`);
      });
      if (result.errors.length > 10) {
        console.log(`  ... and ${result.errors.length - 10} more errors`);
      }
    }

    console.log('\n📝 What happened:');
    if (result.urlsDiscovered > 0) {
      console.log(`  • ${result.urlsDiscovered} new URLs discovered and scraped`);
      console.log(`    → Status set to 'ready_for_indexing'`);
    }
    if (result.urlsUpdated > 0) {
      console.log(`  • ${result.urlsUpdated} pages updated (new or changed content)`);
      console.log(`    → Status set to 'ready_for_indexing' or 'ready_for_re_indexing'`);
    }
    if (result.urlsDeleted > 0) {
      console.log(`  • ${result.urlsDeleted} pages marked for deletion (missing_count >= threshold)`);
      console.log(`    → Status set to 'ready_for_deletion'`);
    }
    if (result.urlsDiscovered === 0 && result.urlsUpdated === 0 && result.urlsDeleted === 0) {
      console.log('  • No changes detected - all pages are up to date');
    }

    console.log('\n📝 Next Steps:');
    console.log('  1. Indexing pipeline has been triggered automatically (async)');
    console.log('  2. Check indexing status with:');
    console.log(`     pnpm test:indexing ${websiteId}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Sync failed:', message);
    
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

