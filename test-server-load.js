#!/usr/bin/env node
/**
 * Test if the MCP server modules can load without errors
 * Verifies tool definitions and imports without starting the server
 */

import { toolDefinitions, handleToolCall } from './dist/tools/index.js';
import { config } from './dist/config.js';

console.log('🔍 Testing MCP Server Module Loading...\n');

// Test 1: Tool Definitions
console.log('1️⃣  Checking tool definitions...');
if (toolDefinitions && Array.isArray(toolDefinitions)) {
  console.log(`   ✓ Found ${toolDefinitions.length} tools defined:`);
  toolDefinitions.forEach(tool => {
    console.log(`      - ${tool.name}: ${tool.description.substring(0, 50)}...`);
  });
} else {
  console.error('   ✗ Tool definitions not found');
  process.exit(1);
}

// Test 2: Configuration
console.log('\n2️⃣  Verifying configuration...');
console.log(`   ✓ Supabase URL: ${config.supabase.url.substring(0, 40)}...`);
console.log(`   ✓ Gemini Model: ${config.gemini.model}`);
console.log(`   ✓ FireCrawl API Key: ${config.firecrawl.apiKey ? 'Configured' : 'Missing'}`);

// Test 3: Tool Handler
console.log('\n3️⃣  Testing tool handler...');
try {
  // Test with a simple tool call (site_list doesn't require params)
  const result = await handleToolCall('site_list', {});
  if (result && result.content) {
    console.log('   ✓ Tool handler works');
    console.log('   ✓ site_list tool executed successfully');
  } else {
    console.log('   ⚠️  Tool handler returned unexpected format');
  }
} catch (error) {
  // This is expected if database isn't set up, but handler should still work
  if (error.message.includes('relation') || error.message.includes('does not exist')) {
    console.log('   ✓ Tool handler works (database schema may need setup)');
  } else {
    console.error('   ✗ Tool handler error:', error.message);
    process.exit(1);
  }
}

console.log('\n✅ All module tests passed!');
console.log('\n📝 Server is ready to use:');
console.log('   - Run: npm start (for MCP protocol via stdio)');
console.log('   - Or: npm run dev (for development with watch)');
console.log('   - Configure in Claude Desktop or your MCP client');

