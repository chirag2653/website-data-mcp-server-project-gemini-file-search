/**
 * Core package exports
 * 
 * This package contains all business logic for website ingestion,
 * indexing, search, and sync services. It is framework-agnostic
 * and can be used by any interface layer (MCP, REST API, CLI, etc.)
 */

// Services
export * as ingestion from './services/ingestion.js';
export * as indexing from './services/indexing.js';
export * as search from './services/search.js';
export * as sync from './services/sync.js';
export * as individualUrl from './services/individual-url.js';
export * as cleanup from './services/cleanup.js';

// Clients
export * as supabase from './clients/supabase.js';
export * as firecrawl from './clients/firecrawl.js';
export * as gemini from './clients/gemini.js';
export * as geminiHttp from './clients/gemini-http.js';

// Types
export * from './types/index.js';

// Utils
export * from './utils/logger.js';
export * from './utils/hash.js';
export * from './utils/url.js';

// Config
export { config } from './config.js';
export type { AppConfig } from './config.js';

