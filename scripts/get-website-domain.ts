#!/usr/bin/env node
/**
 * Quick script to get website domain from ID
 */

import * as supabase from '../packages/core/src/clients/supabase.js';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('\n❌ Error: Website ID required\n');
    console.log('Usage: tsx scripts/get-website-domain.ts <websiteId>\n');
    process.exit(1);
  }

  const websiteId = args[0];

  try {
    const website = await supabase.getWebsiteById(websiteId);
    
    if (!website) {
      console.error(`\n❌ Website not found: ${websiteId}\n`);
      process.exit(1);
    }

    console.log('\n✅ Website Found!\n');
    console.log(`ID: ${website.id}`);
    console.log(`Domain: ${website.domain}`);
    console.log(`Gemini Store ID: ${website.gemini_store_id || 'Not set'}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Error:', message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

