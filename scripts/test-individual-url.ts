#!/usr/bin/env node
/**
 * Direct test script for individual URL indexing service
 * 
 * This script allows you to test the individual URL indexing core logic directly
 * without going through Next.js or MCP server.
 * 
 * Usage:
 *   pnpm test:individual-url <url>
 * 
 * Example:
 *   pnpm test:individual-url https://example.com/page
 * 
 * What it does:
 *   1. Automatically finds website by domain
 *   2. Validates website exists and has pages
 *   3. Checks if URL already exists
 *   4. Scrapes URL using batchScrapeAndProcess
 *   5. Marks page as 'ready_for_indexing'
 *   6. Triggers indexing service automatically
 * 
 * Prerequisites:
 *   - Website must exist in database (created via ingestion)
 *   - Website must have at least one page
 * 
 * If website doesn't exist, the script will suggest running ingestion first.
 */

import * as individualUrlService from '../packages/core/src/services/individual-url.js';
import * as supabase from '../packages/core/src/clients/supabase.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('\n❌ Error: URL required\n');
    console.log('Usage: pnpm test:individual-url <url>\n');
    console.log('Example: pnpm test:individual-url https://example.com/page\n');
    process.exit(1);
  }

  const url = args[0];

  console.log('\n🔗 Testing Individual URL Indexing Service\n');
  console.log(`URL: ${url}\n`);

  try {
    console.log('Starting individual URL indexing...');
    console.log('(This will scrape the URL and trigger indexing)\n');

    const result = await individualUrlService.indexIndividualUrl(url);

    if (result.success) {
      console.log('\n✅ URL Indexing Complete!\n');
      console.log('Results:');
      console.log(`  Website ID: ${result.websiteId}`);
      console.log(`  URL: ${result.url}`);
      console.log(`  Status: ${result.status}`);
      
      if (result.message) {
        console.log(`  Message: ${result.message}`);
      }

      // Check final page status
      const page = await supabase.getPageByUrl(result.url);
      if (page) {
        console.log('\n📄 Page Details:');
        console.log(`  Title: ${page.title || '(no title)'}`);
        console.log(`  Status: ${page.status}`);
        console.log(`  Content Hash: ${page.content_hash ? page.content_hash.substring(0, 16) + '...' : '(none)'}`);
        console.log(`  Gemini File ID: ${page.gemini_file_id || '(not indexed yet)'}`);
        console.log(`  Last Scraped: ${page.last_scraped || '(never)'}`);
        console.log(`  Last Seen: ${page.last_seen || '(never)'}`);
      }

      console.log('\n📝 What happened:');
      if (result.status === 'active') {
        console.log('  • URL is already indexed and active');
      } else if (result.status === 'processing') {
        console.log('  • URL was scraped and marked as ready_for_indexing');
        console.log('  • Indexing service has been triggered');
        console.log('  • Page will be indexed shortly');
      }

      console.log('\n📝 Next Steps:');
      if (result.status === 'processing') {
        console.log('  1. Wait a few moments for indexing to complete');
        console.log('  2. Check page status with:');
        console.log(`     pnpm test:individual-url ${url}`);
      } else {
        console.log('  • URL is ready for search queries');
      }
    } else {
      console.log('\n❌ URL Indexing Failed\n');
      console.log('Results:');
      console.log(`  URL: ${result.url}`);
      console.log(`  Status: ${result.status}`);
      console.log(`  Error: ${result.error || 'Unknown error'}`);
      
      if (result.message) {
        console.log(`  Message: ${result.message}`);
      }

      if (result.suggestion) {
        console.log('\n💡 Suggestion:');
        console.log(`  ${result.suggestion}`);
      }

      if (result.canAutoIngest) {
        console.log('\n💡 To ingest this website first:');
        const domain = new URL(result.url).hostname;
        console.log(`  pnpm test:ingestion https://${domain}`);
      }
    }

    console.log('');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Individual URL indexing failed:', message);
    
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

