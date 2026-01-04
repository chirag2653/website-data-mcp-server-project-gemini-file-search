#!/usr/bin/env node
/**
 * Direct test script for indexing service
 * 
 * This script allows you to test the indexing core logic directly
 * without going through Next.js or MCP server.
 * 
 * Usage:
 *   pnpm test:indexing <websiteId>
 * 
 * Example:
 *   pnpm test:indexing abc123-def456-ghi789
 * 
 * Prerequisites:
 *   1. Website must exist in database
 *   2. Website must have pages with status='ready_for_indexing'
 *   3. Pages must have markdown_content
 * 
 * To get a website ID:
 *   - Check your Supabase database: SELECT id, domain FROM websites;
 *   - Or use the ingestion service first to create a website
 */

import * as indexingService from '../packages/core/src/services/indexing.js';
import * as supabase from '../packages/core/src/clients/supabase.js';
import * as ingestionService from '../packages/core/src/services/ingestion.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('\n❌ Error: Website ID required\n');
    console.log('Usage: pnpm test:indexing <websiteId>\n');
    console.log('Example: pnpm test:indexing abc123-def456-ghi789\n');
    console.log('To find website IDs, check your Supabase database:');
    console.log('  SELECT id, domain, display_name FROM websites;\n');
    process.exit(1);
  }

  const websiteId = args[0];

  console.log('\n🔍 Testing Indexing Service\n');
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
    console.log(`   Store ID: ${website.gemini_store_id || '(none - will be created)'}\n`);

    // Step 2: Check pages ready for processing (indexing, re-indexing, deletion)
    console.log('Step 2: Checking pages ready for processing...');
    const [pagesReadyForIndexing, pagesReadyForReIndexing, pagesReadyForDeletion] = await Promise.all([
      supabase.getPagesReadyForIndexing(websiteId, { limit: 1000 }),
      supabase.getPagesReadyForReIndexing(websiteId, { limit: 1000 }),
      supabase.getPagesReadyForDeletion(websiteId, { limit: 1000 }),
    ]);

    const totalPagesReady = pagesReadyForIndexing.length + pagesReadyForReIndexing.length + pagesReadyForDeletion.length;
    
    console.log(`   Found ${totalPagesReady} pages ready for processing:`);
    console.log(`     - New pages (ready_for_indexing): ${pagesReadyForIndexing.length}`);
    console.log(`     - Updated pages (ready_for_re_indexing): ${pagesReadyForReIndexing.length}`);
    console.log(`     - Deletion pages (ready_for_deletion): ${pagesReadyForDeletion.length}`);
    
    if (totalPagesReady === 0) {
      console.log('\n⚠️  No pages ready for processing.');
      console.log('\nPages need one of these statuses:');
      console.log('  - "ready_for_indexing" (new pages)');
      console.log('  - "ready_for_re_indexing" (updated pages)');
      console.log('  - "ready_for_deletion" (missing pages)');
      
      // Show page statuses
      const allPages = await supabase.getPagesByWebsite(websiteId);
      console.log(`\nTotal pages for this website: ${allPages.length}`);
      
      if (allPages.length > 0) {
        const statusCounts = allPages.reduce((acc, page) => {
          acc[page.status] = (acc[page.status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
        
        console.log('\nPage status breakdown:');
        Object.entries(statusCounts).forEach(([status, count]) => {
          console.log(`  - ${status}: ${count}`);
        });
      }
      
      console.log('\n💡 Tip: Run ingestion or sync first to prepare pages for indexing.\n');
      process.exit(0);
    }

    console.log(`   Total pages with content: ${pagesReadyForIndexing.length + pagesReadyForReIndexing.length}\n`);

    // Step 3: Run indexing
    console.log('Step 3: Running indexing service...\n');
    const result = await indexingService.indexWebsite(websiteId, {
      autoCreateStore: true,
    });

    // Step 4: Display results
    console.log('\n✅ Indexing Complete!\n');
    console.log('Results:');
    console.log(`  Indexing Job ID: ${result.indexingJobId}`);
    console.log(`  Website ID: ${result.websiteId}`);
    console.log(`  Pages Indexed: ${result.pagesIndexed}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.url || 'Unknown'}: ${error.error}`);
      });
    }

    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Indexing failed:', message);
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

