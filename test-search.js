#!/usr/bin/env node
/**
 * Test website search with detailed logging
 */

import * as search from './dist/services/search.js';

const websiteDomain = 'smartscalemarketing.com';
const question = 'What is this company\'s positioning statement?';

console.log('🔍 Starting Website Search Test\n');
console.log('='.repeat(60));
console.log(`Domain: ${websiteDomain}`);
console.log(`Question: ${question}`);
console.log('='.repeat(60));
console.log('\n');

try {
  console.log('📋 Search Process:\n');
  console.log('1️⃣  Validating input...');
  console.log('2️⃣  Resolving domain to base domain...');
  console.log('3️⃣  Looking up website in Supabase...');
  console.log('4️⃣  Executing search with Gemini File Search...');
  console.log('5️⃣  Extracting citations...');
  console.log('\n⏳ Executing search...\n');

  const startTime = Date.now();
  
  const result = await search.askQuestion(question, websiteDomain);
  
  const duration = (Date.now() - startTime) / 1000;

  console.log('\n✅ Search Complete!\n');
  console.log('='.repeat(60));
  console.log('📊 Results:');
  console.log('='.repeat(60));
  console.log(`Website ID: ${result.websiteId}`);
  console.log(`Duration: ${duration.toFixed(2)} seconds`);
  console.log(`Sources Found: ${result.sources.length}`);
  console.log('\n💬 Answer:');
  console.log('-'.repeat(60));
  console.log(result.answer);
  console.log('-'.repeat(60));
  
  if (result.sources.length > 0) {
    console.log('\n📚 Citations:');
    console.log('-'.repeat(60));
    result.sources.forEach((source, index) => {
      console.log(`\n${index + 1}. ${source.title || 'No title'}`);
      console.log(`   URL: ${source.url}`);
    });
    console.log('-'.repeat(60));
  } else {
    console.log('\n⚠️  No citations found');
  }
  
} catch (error) {
  console.error('\n❌ Search Failed:\n');
  console.error(error.message);
  if (error.stack) {
    console.error('\nStack trace:');
    console.error(error.stack);
  }
  process.exit(1);
}
