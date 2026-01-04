#!/usr/bin/env node
/**
 * Direct test script for ingestion service
 * 
 * This script allows you to test the ingestion core logic directly
 * without going through Next.js or MCP server.
 * 
 * Usage:
 *   pnpm test:ingestion <url> [displayName]
 * 
 * Example:
 *   pnpm test:ingestion https://example.com "Example Website"
 * 
 * What it does:
 *   1. Ingests the website (discovers URLs, scrapes content)
 *   2. Stores pages in database with status='ready_for_indexing'
 *   3. Returns website ID for subsequent indexing test
 */

import * as ingestionService from '../packages/core/src/services/ingestion.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('\n❌ Error: URL required\n');
    console.log('Usage: pnpm test:ingestion <url> [displayName]\n');
    console.log('Example: pnpm test:ingestion https://example.com "Example Website"\n');
    process.exit(1);
  }

  const url = args[0];
  const displayName = args[1];

  console.log('\n🚀 Testing Ingestion Service\n');
  console.log(`URL: ${url}`);
  if (displayName) {
    console.log(`Display Name: ${displayName}`);
  }
  console.log('');

  try {
    console.log('Starting ingestion...');
    console.log('(This may take several minutes depending on website size)\n');

    const result = await ingestionService.ingestWebsite(url, displayName);

    console.log('\n✅ Ingestion Complete!\n');
    console.log('Results:');
    console.log(`  Website ID: ${result.websiteId}`);
    console.log(`  Domain: ${result.domain}`);
    console.log(`  Gemini Store ID: ${result.geminiStoreId}`);
    console.log(`  Pages Discovered: ${result.pagesDiscovered}`);
    console.log(`  Pages Scraped: ${result.pagesIndexed}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.slice(0, 5).forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.url || 'Unknown'}: ${error.error}`);
      });
      if (result.errors.length > 5) {
        console.log(`  ... and ${result.errors.length - 5} more errors`);
      }
    }

    console.log('\n📝 Next Steps:');
    console.log(`  1. Pages are now stored with status='ready_for_indexing'`);
    console.log(`  2. Test indexing with:`);
    console.log(`     pnpm test:indexing ${result.websiteId}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Ingestion failed:', message);
    
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

