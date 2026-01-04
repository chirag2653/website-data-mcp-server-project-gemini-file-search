/**
 * URL utilities for domain extraction and path handling
 */
/**
 * Extract domain from URL (without protocol or path)
 */
export declare function extractDomain(url: string): string;
/**
 * Extract base domain (removes www subdomain)
 *
 * Examples:
 * - www.example.com → example.com
 * - example.com → example.com
 * - subdomain.example.com → subdomain.example.com (other subdomains preserved)
 */
export declare function extractBaseDomain(domain: string): string;
/**
 * Check if URL belongs to a specific base domain
 * Accepts both www and non-www versions of the base domain
 *
 * Examples:
 * - example.com matches example.com ✅
 * - www.example.com matches example.com ✅
 * - example.com matches www.example.com ✅
 * - subdomain.example.com does NOT match example.com ❌
 */
export declare function isUrlInDomain(url: string, baseDomain: string): boolean;
/**
 * Extract path from URL
 */
export declare function extractPath(url: string): string;
/**
 * Normalize URL for consistent storage
 * - Ensures protocol
 * - Removes trailing slash (except for root)
 * - Removes fragment
 * - Lowercases domain
 */
export declare function normalizeUrl(url: string): string;
/**
 * Filter URLs to only include those from a specific domain
 */
export declare function filterUrlsByDomain(urls: string[], domain: string): string[];
/**
 * Normalize domain input to extract clean base domain
 * Handles various input formats:
 * - Full URLs: "https://www.example.com/path" → "www.example.com"
 * - URLs with query: "https://example.com?param=value" → "example.com"
 * - Domains with extra text: "example.com some text" → "example.com"
 * - Plain domains: "example.com" → "example.com"
 * - Domains with protocol: "https://example.com" → "example.com"
 *
 * @param input - Domain string that may contain URL, protocol, path, or extra text
 * @returns Clean domain (hostname only, lowercase)
 */
export declare function normalizeDomain(input: string): string;
//# sourceMappingURL=url.d.ts.map