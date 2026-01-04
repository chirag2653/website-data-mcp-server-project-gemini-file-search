/**
 * Content hashing utilities for change detection
 */

import { createHash } from 'crypto';
import { compareTwoStrings } from 'string-similarity';

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

/**
 * Check if content has changed significantly based on similarity comparison
 * Uses Dice coefficient (Sørensen–Dice) to calculate similarity between 0 and 1
 * 
 * @param newContent - New markdown content
 * @param existingContent - Existing markdown content (null if page doesn't exist)
 * @param similarityThreshold - Minimum similarity to consider unchanged (default: 0.95 = 95%)
 * @returns Object with changed status, new hash, and similarity score (0-1)
 */
export function hasContentChangedSignificantly(
  newContent: string,
  existingContent: string | null,
  similarityThreshold: number = 0.95
): { changed: boolean; newHash: string; similarity: number } {
  const newHash = computeContentHash(newContent);
  
  // If no existing content, it's definitely changed
  if (!existingContent) {
    return { changed: true, newHash, similarity: 0 };
  }
  
  // Fast path: if hashes match, content is identical (after normalization)
  const existingHash = computeContentHash(existingContent);
  if (newHash === existingHash) {
    return { changed: false, newHash, similarity: 1.0 };
  }
  
  // Hash differs - calculate similarity using Dice coefficient
  // This compares the actual content, not just normalized hashes
  // Returns a value between 0 (completely different) and 1 (identical)
  const similarity = compareTwoStrings(existingContent, newContent);
  const changed = similarity < similarityThreshold;
  
  return { changed, newHash, similarity };
}
