/**
 * Content hashing utilities for change detection
 */

import { createHash } from 'crypto';

/**
 * Normalize content for consistent hashing
 * - Trims whitespace
 * - Normalizes line endings
 * - Removes excessive whitespace
 * - Lowercases for comparison
 */
export function normalizeContent(content: string): string {
  return content
    // Normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove excessive blank lines (more than 2 consecutive)
    .replace(/\n{3,}/g, '\n\n')
    // Trim each line
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    // Trim overall content
    .trim()
    // Lowercase for comparison
    .toLowerCase();
}

/**
 * Compute SHA256 hash of content
 */
export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Compute hash of normalized content for change detection
 */
export function computeContentHash(content: string): string {
  const normalized = normalizeContent(content);
  return sha256(normalized);
}

/**
 * Check if content has changed based on hash comparison
 */
export function hasContentChanged(
  newContent: string,
  existingHash: string | null
): { changed: boolean; newHash: string } {
  const newHash = computeContentHash(newContent);
  const changed = existingHash !== newHash;
  return { changed, newHash };
}
