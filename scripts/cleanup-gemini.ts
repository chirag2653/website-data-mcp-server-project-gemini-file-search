#!/usr/bin/env node
/**
 * Cleanup script for Gemini File Search stores and documents
 * 
 * This is a SCRIPT - an executable entry point that uses the cleanup SERVICE.
 * 
 * Service vs Script:
 * - SERVICE (src/services/cleanup.ts): Reusable functions that can be imported in code
 * - SCRIPT (this file): Executable file that calls the service - can be run from command line
 * 
 * Usage:
 *   npm run cleanup          # FULL cleanup: delete ALL documents AND stores
 *   npm run cleanup:docs     # Partial: delete documents only (keeps stores)
 *   tsx scripts/cleanup-gemini.ts [--docs-only] [--filter=pattern]
 */

import * as cleanupService from '../packages/core/src/services/cleanup.js';

async function main() {
  const args = process.argv.slice(2);
  // Default: FULL cleanup (delete stores). Use --docs-only for partial cleanup
  const deleteStores = !args.includes('--docs-only');
  const filterArg = args.find(arg => arg.startsWith('--filter='));
  const storeFilter = filterArg ? filterArg.split('=')[1] : undefined;

  console.log('\n🧹 Gemini File Search Cleanup\n');
  console.log('Mode: ' + (deleteStores ? 'FULL CLEANUP (documents + stores)' : 'PARTIAL (documents only)'));
  console.log(`  Delete stores: ${deleteStores ? 'YES ✅' : 'NO (documents only)'}`);
  console.log(`  Store filter: ${storeFilter || 'none (all stores)'}`);
  console.log('');

  if (deleteStores) {
    console.log('⚠️  WARNING: This will DELETE ALL stores and documents!');
    console.log('   This removes all traces of your work in Gemini File Search.\n');
  }

  try {
    const result = await cleanupService.cleanupGeminiStores({
      deleteStores,
      storeFilter,
    });

    console.log('\n✅ Cleanup Complete!\n');
    console.log('Summary:');
    console.log(`  Stores processed: ${result.stores.length}`);
    console.log(`  Stores deleted: ${result.storesDeleted}`);
    console.log(`  Documents deleted: ${result.documentsDeleted}`);
    console.log(`  Errors: ${result.errors.length}`);

    if (result.stores.length > 0) {
      console.log('\nStores cleaned:');
      result.stores.forEach(store => {
        console.log(`  - ${store.displayName} (${store.name})`);
        console.log(`    Documents deleted: ${store.documentsDeleted}`);
      });
    }

    if (result.errors.length > 0) {
      console.log('\n⚠️  Errors encountered:');
      result.errors.forEach((error, index) => {
        console.log(`  ${index + 1}. ${error.store || error.document || 'Unknown'}: ${error.error}`);
      });
    }

    console.log('\n');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('\n❌ Cleanup failed:', message);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

