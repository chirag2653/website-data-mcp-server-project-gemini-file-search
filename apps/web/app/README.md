# Ingestion Service UI

A clean, modern UI for the website ingestion service built with Next.js 15 and Server Actions.

## Features

- ✅ **Check Website Status**: Enter a URL to check if it's already been processed
- ✅ **Smart Detection**: Automatically detects if website exists or is new
- ✅ **One-Click Ingestion**: Start ingestion for new websites with a single click
- ✅ **Real-time Status**: See progress and status updates in real-time
- ✅ **Error Handling**: Clear error messages and retry options

## Setup

1. **Install Dependencies**:
   ```bash
   npm install
   ```

2. **Configure Environment Variables**:
   Make sure your `.env` file has all required variables (same as the main MCP server):
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `GEMINI_API_KEY`
   - `FIRECRAWL_API_KEY`

3. **Run the Development Server**:
   ```bash
   npm run next:dev
   ```

4. **Open in Browser**:
   Navigate to `http://localhost:3000`

## Architecture

### Server Actions (Modern Next.js Approach)
- **Location**: `app/actions/ingestion.ts`
- **Why Server Actions?**: 
  - Direct function calls from React components
  - Type-safe with TypeScript
  - Built-in loading states
  - No manual API route handling needed
  - Progressive enhancement

### Components
- `IngestionForm`: Main form component with state management
- `UrlInput`: URL and display name input fields
- `StatusDisplay`: Shows different states (checking, exists, new, ingesting, error)

### Flow
1. User enters URL → `checkWebsite` server action
2. If exists → Show existing website info
3. If new → Show "Start Ingestion" button
4. User clicks → `ingestWebsite` server action
5. Show progress → Display results

## Why Server Actions Over Route Handlers?

**Server Actions** are recommended for this use case because:
- Form-based interactions work seamlessly
- Built-in loading states with `useTransition`
- Type-safe end-to-end
- Simpler code (no fetch/API calls)
- Better for mutations (ingestion is a mutation)

**Route Handlers** would be better if:
- You need external API consumption
- You need explicit HTTP methods
- You need to call from non-React clients

## Notes

- The ingestion service runs asynchronously (may take several minutes)
- The UI shows immediate feedback, but actual ingestion happens in the background
- The sync service is not affected by this UI (only ingestion service is used)

