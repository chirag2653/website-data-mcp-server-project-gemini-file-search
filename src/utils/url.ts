/**
 * URL utilities for domain extraction and path handling
 */

/**
 * Extract domain from URL (without protocol or path)
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname;
  } catch {
    // Fallback: try to extract domain manually
    const match = url.match(/^(?:https?:\/\/)?([^\/\?#]+)/i);
    return match?.[1] ?? url;
  }
}

/**
 * Check if URL belongs to a specific domain (exact match only)
 * Each domain/subdomain is treated as a separate website
 * 
 * Examples:
 * - example.com matches example.com ✅
 * - www.example.com matches www.example.com ✅
 * - www.example.com does NOT match example.com ❌
 * - subdomain.example.com does NOT match example.com ❌
 */
export function isUrlInDomain(url: string, domain: string): boolean {
  const urlDomain = extractDomain(url).toLowerCase();
  const targetDomain = domain.toLowerCase();

  // Exact match only - no subdomain matching
  return urlDomain === targetDomain;
}

/**
 * Extract path from URL
 */
export function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return '/';
  }
}

/**
 * Normalize URL for consistent storage
 * - Ensures protocol
 * - Removes trailing slash (except for root)
 * - Removes fragment
 * - Lowercases domain
 */
export function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Lowercase hostname
    parsed.hostname = parsed.hostname.toLowerCase();

    // Remove fragment
    parsed.hash = '';

    // Build normalized URL
    let normalized = parsed.toString();

    // Remove trailing slash (except for root path)
    if (parsed.pathname !== '/' && normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    // If URL parsing fails, return as-is with protocol
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return `https://${url}`;
    }
    return url;
  }
}


/**
 * Filter URLs to only include those from a specific domain
 */
export function filterUrlsByDomain(urls: string[], domain: string): string[] {
  return urls.filter((url) => isUrlInDomain(url, domain));
}
