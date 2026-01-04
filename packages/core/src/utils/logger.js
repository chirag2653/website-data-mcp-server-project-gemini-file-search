/**
 * Structured logging utility using pino
 */
import pino from 'pino';
import { config } from '../config.js';
export const logger = pino({
    level: config.logging.level,
    transport: {
        target: 'pino-pretty',
        options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
        },
    },
});
/**
 * Create a child logger with a specific context
 */
export function createLogger(context) {
    return logger.child({ context });
}
// Named loggers for each module
export const loggers = {
    supabase: createLogger('supabase'),
    firecrawl: createLogger('firecrawl'),
    gemini: createLogger('gemini'),
    ingestion: createLogger('ingestion'),
    sync: createLogger('sync'),
    search: createLogger('search'),
    mcp: createLogger('mcp'),
};
//# sourceMappingURL=logger.js.map