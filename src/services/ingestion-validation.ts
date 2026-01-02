/**
 * Input validation schemas for ingestion service
 * Production-grade validation using Zod
 */

import { z } from 'zod';

/**
 * Validates that input is a valid URL or domain
 * Accepts:
 * - Full URLs: https://www.example.com, http://example.com/path
 * - Domains: example.com, www.example.com
 * - Domains with protocol: https://example.com
 */
export const ingestionInputSchema = z
  .string()
  .min(1, 'URL or domain is required')
  .refine(
    (input) => {
      // Try to parse as URL
      try {
        const url = new URL(input.startsWith('http') ? input : `https://${input}`);
        // Must have a valid hostname
        return url.hostname.length > 0 && url.hostname.includes('.');
      } catch {
        // If URL parsing fails, check if it's a valid domain format
        const domainPattern = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;
        return domainPattern.test(input);
      }
    },
    {
      message: 'Input must be a valid URL or domain (e.g., https://example.com or example.com)',
    }
  );

/**
 * Validates display name (optional)
 */
export const displayNameSchema = z
  .string()
  .min(1, 'Display name cannot be empty')
  .max(512, 'Display name must be 512 characters or less')
  .optional();

/**
 * Validates ingestion input
 * @throws {z.ZodError} if validation fails
 */
export function validateIngestionInput(
  seedUrl: string,
  displayName?: string
): { seedUrl: string; displayName?: string } {
  const validatedSeedUrl = ingestionInputSchema.parse(seedUrl);
  const validatedDisplayName = displayName ? displayNameSchema.parse(displayName) : undefined;

  return {
    seedUrl: validatedSeedUrl,
    displayName: validatedDisplayName,
  };
}

