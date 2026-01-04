/**
 * Content hashing utilities for change detection
 */
/**
 * Normalize content for consistent hashing
 * - Trims whitespace
 * - Normalizes line endings
 * - Removes excessive whitespace
 * - Lowercases for comparison
 */
export declare function normalizeContent(content: string): string;
/**
 * Compute SHA256 hash of content
 */
export declare function sha256(content: string): string;
/**
 * Compute hash of normalized content for change detection
 */
export declare function computeContentHash(content: string): string;
/**
 * Check if content has changed based on hash comparison
 */
export declare function hasContentChanged(newContent: string, existingHash: string | null): {
    changed: boolean;
    newHash: string;
};
//# sourceMappingURL=hash.d.ts.map