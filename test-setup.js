#!/usr/bin/env node
/**
 * Quick setup verification script
 * Tests if environment variables are configured and basic connections work
 */

import { config } from './dist/config.js';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

console.log('🔍 Testing Website Data MCP Server Setup...\n');

// Test 1: Environment Configuration
console.log('1️⃣  Checking environment configuration...');
try {
  console.log('   ✓ Configuration loaded successfully');
  console.log(`   - Supabase URL: ${config.supabase.url.substring(0, 30)}...`);
  console.log(`   - Gemini Model: ${config.gemini.model}`);
  console.log(`   - Log Level: ${config.logging.level}`);
} catch (error) {
  console.error('   ✗ Configuration error:', error.message);
  process.exit(1);
}

// Test 2: Supabase Connection
console.log('\n2️⃣  Testing Supabase connection...');
try {
  const supabase = createClient(config.supabase.url, config.supabase.serviceKey);
  // Try a simple query to test connection
  const { data, error } = await supabase.from('websites').select('id').limit(1);
  
  if (error) {
    // Check if it's a schema error (table doesn't exist) vs connection error
    if (error.message.includes('relation') && error.message.includes('does not exist')) {
      console.log('   ⚠️  Supabase connected, but schema not found');
      console.log('   → Run the migration: supabase/migrations/001_initial_schema.sql');
    } else {
      throw error;
    }
  } else {
    console.log('   ✓ Supabase connection successful');
  }
} catch (error) {
  console.error('   ✗ Supabase connection failed:', error.message);
  console.error('   → Check SUPABASE_URL and SUPABASE_SERVICE_KEY in .env');
  process.exit(1);
}

// Test 3: Gemini API
console.log('\n3️⃣  Testing Gemini API...');
try {
  const genai = new GoogleGenAI({ apiKey: config.gemini.apiKey });
  // Try to list models to verify API key
  const models = await genai.models.list();
  console.log('   ✓ Gemini API connection successful');
  console.log(`   - Model configured: ${config.gemini.model}`);
} catch (error) {
  console.error('   ✗ Gemini API connection failed:', error.message);
  console.error('   → Check GEMINI_API_KEY in .env');
  console.error('   → Ensure API key has File Search access');
  process.exit(1);
}

// Test 4: FireCrawl API (basic check)
console.log('\n4️⃣  Checking FireCrawl API key...');
if (config.firecrawl.apiKey && config.firecrawl.apiKey.length > 0) {
  console.log('   ✓ FireCrawl API key configured');
  console.log('   → Note: Actual API test requires making a request (uses credits)');
} else {
  console.error('   ✗ FireCrawl API key missing');
  console.error('   → Check FIRECRAWL_API_KEY in .env');
  process.exit(1);
}

console.log('\n✅ All basic checks passed!');
console.log('\n📝 Next steps:');
console.log('   1. Ensure database schema is applied (see supabase/migrations/)');
console.log('   2. Test MCP server: npm start');
console.log('   3. Try ingesting a website using site_ingest tool');

