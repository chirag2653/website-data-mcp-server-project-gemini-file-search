#!/usr/bin/env node
/**
 * Direct test script for search service
 * 
 * This script allows you to test the search core logic directly
 * without going through Next.js or MCP server.
 * 
 * Usage:
 *   pnpm test:search <question> <websiteDomain>
 * 
 * Example:
 *   pnpm test:search "What is vectorize.io?" "vectorize.io"
 *   pnpm test:search "How does pricing work?" "https://www.vectorize.io"
 * 
 * Parameters:
 *   question - The question to ask about the website content
 *   websiteDomain - The website domain (can be URL, domain, or domain with path)
 *                   Examples: "example.com", "https://www.example.com", "www.example.com/path"
 * 
 * Prerequisites:
 *   1. Website must exist in database (run ingestion first)
 *   2. Website must have indexed pages (run indexing first)
 */

import * as searchService from '../packages/core/src/services/search.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('\n❌ Error: Question and website domain required\n');
    console.log('Usage: pnpm test:search <question> <websiteDomain>\n');
    console.log('Example:');
    console.log('  pnpm test:search "What is vectorize.io?" "vectorize.io"');
    console.log('  pnpm test:search "How does pricing work?" "https://www.vectorize.io"\n');
    process.exit(1);
  }

  const question = args[0];
  const websiteDomain = args[1];

  console.log('\n🔍 Testing Search Service\n');
  console.log(`Question: ${question}`);
  console.log(`Website Domain: ${websiteDomain}\n`);

  try {
    console.log('Searching for answer...\n');
    
    const result = await searchService.askQuestion(question, websiteDomain);

    console.log('\n✅ Search Complete!\n');
    console.log('Answer:');
    console.log('─'.repeat(80));
    console.log(result.answer);
    console.log('─'.repeat(80));
    
    if (result.sources && result.sources.length > 0) {
      console.log(`\n📚 Sources (${result.sources.length}):`);
      result.sources.forEach((source, index) => {
        console.log(`\n  ${index + 1}. ${source.url || 'Unknown URL'}`);
        if (source.title) {
          console.log(`     Title: ${source.title}`);
        }
        if (source.snippet) {
          console.log(`     Snippet: ${source.snippet.substring(0, 150)}${source.snippet.length > 150 ? '...' : ''}`);
        }
      });
    } else {
      console.log('\n⚠️  No sources found');
    }

    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Search failed:', message);
    
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

