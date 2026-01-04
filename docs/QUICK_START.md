# Quick Start Guide

## ✅ Setup Complete!

Your Website Data MCP Server is built and ready to use. All tests passed:

- ✅ Dependencies installed
- ✅ TypeScript compiled successfully
- ✅ Environment variables configured
- ✅ Supabase connection verified
- ✅ Gemini API connection verified
- ✅ FireCrawl API key configured
- ✅ All 8 MCP tools loaded and working

## 🚀 How to Use

### Option 1: Run as MCP Server (Recommended)

The server communicates via stdio for the MCP protocol. To use it:

1. **Configure in Claude Desktop** (or your MCP client):
   ```json
   {
     "mcpServers": {
       "website-data": {
         "command": "node",
         "args": ["C:/Users/chira/Downloads/Local - HQ - Master/Coding/website-data-mcp-server-project-gemini-file-search/dist/index.js"],
         "env": {
           "SUPABASE_URL": "your-url",
           "SUPABASE_SERVICE_KEY": "your-key",
           "GEMINI_API_KEY": "your-key",
           "FIRECRAWL_API_KEY": "your-key"
         }
       }
     }
   }
   ```

2. **Or run directly** (for testing):
   ```bash
   npm start
   ```
   Note: This will wait for MCP protocol messages via stdio.

### Option 2: Development Mode

For development with auto-reload:
```bash
npm run dev
```

## 🧪 Testing

### Run Setup Verification
```bash
node test-setup.js
```

### Test Server Modules
```bash
node test-server-load.js
```

## 📋 Available Tools

1. **`site_ingest`** - Ingest a new website (discovers all pages, scrapes, indexes)
2. **`site_sync`** - Sync existing website (find new/changed pages)
3. **`site_ask`** - Ask questions about website content
4. **`site_list`** - List all indexed websites
5. **`site_check_existing_content`** - Check if content exists about a topic
6. **`site_find_mentions`** - Find pages mentioning keywords
7. **`site_get_url_status`** - Check status of a specific URL
8. **`site_reindex_url`** - Force re-index a URL

## 🎯 First Steps

1. **Ingest your first website:**
   ```
   Use tool: site_ingest
   Parameters: {
     "seedUrl": "https://example.com",
     "displayName": "Example Site"
   }
   ```

2. **Ask questions:**
   ```
   Use tool: site_ask
   Parameters: {
     "question": "What is this website about?",
     "websiteId": "optional-uuid"
   }
   ```

3. **List websites:**
   ```
   Use tool: site_list
   Parameters: {}
   ```

## 📊 Current Status

- **Database**: Connected ✅
- **Gemini API**: Connected ✅
- **FireCrawl API**: Configured ✅
- **Tools**: 8 tools loaded ✅
- **Build**: Successful ✅

## 🔧 Troubleshooting

### If you see "relation does not exist" errors:
- Run the database migration: `supabase/migrations/001_initial_schema.sql`
- Apply it in your Supabase SQL Editor

### If MCP server doesn't respond:
- Check that environment variables are set in `.env`
- Verify the server is running: `npm start`
- Check logs for errors

### If API calls fail:
- Verify API keys are valid
- Check API quotas/credits (especially FireCrawl)
- Ensure Gemini API key has File Search access

## 📚 Documentation

See `README.md` for full documentation including:
- Architecture overview
- Database schema
- API reference
- Implementation details

