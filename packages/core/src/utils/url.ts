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
 * Extract base domain (removes www subdomain)
 * 
 * Examples:
 * - www.example.com → example.com
 * - example.com → example.com
 * - subdomain.example.com → subdomain.example.com (other subdomains preserved)
 */
export function extractBaseDomain(domain: string): string {
  const normalized = domain.toLowerCase().trim();
  
  // Remove www. prefix if present
  if (normalized.startsWith('www.')) {
    return normalized.substring(4);
  }
  
  return normalized;
}

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
export function isUrlInDomain(url: string, baseDomain: string): boolean {
  const urlDomain = extractDomain(url).toLowerCase();
  const urlBaseDomain = extractBaseDomain(urlDomain);
  const targetBaseDomain = extractBaseDomain(baseDomain);

  // Match if base domains are the same (handles www vs non-www)
  return urlBaseDomain === targetBaseDomain;
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
export function normalizeDomain(input: string): string {
  // Remove leading/trailing whitespace
  let cleaned = input.trim();
  
  // Try to extract domain from URL format
  try {
    // If it starts with http:// or https://, parse as URL
    if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
      const url = new URL(cleaned);
      return url.hostname.toLowerCase();
    }
    
    // Try parsing with https:// prefix
    const url = new URL(`https://${cleaned}`);
    return url.hostname.toLowerCase();
  } catch {
    // If URL parsing fails, try to extract domain manually
    // Remove common prefixes/suffixes and extract domain pattern
    const domainPattern = /([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}/i;
    const match = cleaned.match(domainPattern);
    
    if (match) {
      return match[0].toLowerCase();
    }
    
    // If no pattern match, return cleaned input (might be invalid, but let validation handle it)
    return cleaned.toLowerCase();
  }
}
