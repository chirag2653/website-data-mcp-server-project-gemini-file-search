/**
 * Environment configuration loader with validation
 */

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';
import type { AppConfig } from './types/index.js';

// Load .env file
dotenvConfig();

// Environment schema with validation
const envSchema = z.object({
  // Required
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid URL'),
  SUPABASE_SERVICE_KEY: z.string().min(1, 'SUPABASE_SERVICE_KEY is required'),
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  FIRECRAWL_API_KEY: z.string().min(1, 'FIRECRAWL_API_KEY is required'),

  // Optional with defaults
  GEMINI_MODEL: z.string().default('gemini-2.5-flash'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  SYNC_INTERVAL_HOURS: z.coerce.number().int().positive().default(12),
  DELETION_THRESHOLD: z.coerce.number().int().positive().default(3),
});

type EnvConfig = z.infer<typeof envSchema>;

/**
 * Load and validate environment configuration
 */
function loadConfig(): AppConfig {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.errors
      .map((e) => `  - ${e.path.join('.')}: ${e.message}`)
      .join('\n');

    throw new Error(`Environment configuration errors:\n${errors}`);
  }

  const env: EnvConfig = result.data;

  return {
    supabase: {
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_KEY,
    },
    gemini: {
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    },
    firecrawl: {
      apiKey: env.FIRECRAWL_API_KEY,
    },
    sync: {
      intervalHours: env.SYNC_INTERVAL_HOURS,
      deletionThreshold: env.DELETION_THRESHOLD,
    },
    logging: {
      level: env.LOG_LEVEL,
    },
  };
}

// Export singleton config instance
export const config = loadConfig();

// Re-export for convenience
export type { AppConfig };
