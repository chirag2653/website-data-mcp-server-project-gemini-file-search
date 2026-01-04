/**
 * Structured logging utility using pino
 */
import pino from 'pino';
export declare const logger: pino.Logger<never, boolean>;
/**
 * Create a child logger with a specific context
 */
export declare function createLogger(context: string): pino.Logger<never, boolean>;
export declare const loggers: {
    supabase: pino.Logger<never, boolean>;
    firecrawl: pino.Logger<never, boolean>;
    gemini: pino.Logger<never, boolean>;
    ingestion: pino.Logger<never, boolean>;
    sync: pino.Logger<never, boolean>;
    search: pino.Logger<never, boolean>;
    mcp: pino.Logger<never, boolean>;
};
//# sourceMappingURL=logger.d.ts.map