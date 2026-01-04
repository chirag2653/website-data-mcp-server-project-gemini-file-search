#!/usr/bin/env node
/**
 * List all websites in the database
 * 
 * Usage: pnpm list:websites
 * 
 * This helps you find website IDs for testing indexing
 */

import * as ingestionService from '../packages/core/src/services/ingestion.js';

async function main() {
  console.log('\n📋 Listing Websites\n');

  try {
    const websites = await ingestionService.listWebsites();

    if (websites.length === 0) {
      console.log('No websites found in database.\n');
      console.log('💡 To create a website:');
      console.log('   1. Run: pnpm web:dev');
      console.log('   2. Navigate to http://localhost:3000');
      console.log('   3. Enter a URL and click "Run Ingestion"\n');
      process.exit(0);
    }

    console.log(`Found ${websites.length} website(s):\n`);

    websites.forEach((website, index) => {
      console.log(`${index + 1}. Website ID: ${website.id}`);
      console.log(`   Domain: ${website.domain}`);
      if (website.displayName) {
        console.log(`   Display Name: ${website.displayName}`);
      }
      console.log(`   Pages: ${website.pageCount}`);
      if (website.lastCrawl) {
        console.log(`   Last Crawl: ${website.lastCrawl}`);
      }
      console.log('');
    });

    console.log('💡 To test indexing, run:');
    console.log(`   pnpm test:indexing <websiteId>\n`);
    console.log('Example:');
    if (websites.length > 0) {
      console.log(`   pnpm test:indexing ${websites[0].id}\n`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Failed to list websites:', message);
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

