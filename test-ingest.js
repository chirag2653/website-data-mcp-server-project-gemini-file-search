#!/usr/bin/env node
/**
 * Test website ingestion with detailed logging
 * Walks through the entire ingestion process step by step
 */

import * as ingestion from './dist/services/ingestion.js';

const websiteUrl = 'https://smartscalemarketing.com/';
const displayName = 'Smart Scale Marketing - AI Marketing Automation Agency';

console.log('🚀 Starting Website Ingestion Test\n');
console.log('='.repeat(60));
console.log(`Website: ${websiteUrl}`);
console.log(`Display Name: ${displayName}`);
console.log('='.repeat(60));
console.log('\n');

try {
  console.log('📋 Step-by-Step Process:\n');
  console.log('1️⃣  Creating Gemini File Search store...');
  console.log('2️⃣  Creating website record in Supabase...');
  console.log('3️⃣  Discovering all URLs via FireCrawl /map...');
  console.log('4️⃣  Storing URLs in database as "pending"...');
  console.log('5️⃣  Batch scraping all pages...');
  console.log('6️⃣  Uploading each page to Gemini File Search...');
  console.log('7️⃣  Updating database with "active" status...');
  console.log('\n⏳ Starting ingestion (this may take a few minutes)...\n');

  const startTime = Date.now();
  
  const result = await ingestion.ingestWebsite(websiteUrl, displayName);
  
  const duration = (Date.now() - startTime) / 1000;

  console.log('\n✅ Ingestion Complete!\n');
  console.log('='.repeat(60));
  console.log('📊 Results:');
  console.log('='.repeat(60));
  console.log(`Website ID: ${result.websiteId}`);
  console.log(`Domain: ${result.domain}`);
  console.log(`Pages Discovered: ${result.pagesDiscovered}`);
  console.log(`Pages Indexed: ${result.pagesIndexed}`);
  console.log(`Errors: ${result.errors.length}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  
  if (result.errors.length > 0) {
    console.log('\n⚠️  Errors encountered:');
    result.errors.forEach((error, index) => {
      console.log(`   ${index + 1}. ${error.url}: ${error.error}`);
    });
  }
  
  console.log('\n📝 Next Steps:');
  console.log('   - Use site_ask to query the website');
  console.log('   - Use site_list to see all websites');
  console.log('   - Use site_sync to update the website later');
  
} catch (error) {
  console.error('\n❌ Ingestion Failed:\n');
  console.error(error.message);
  if (error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
}

