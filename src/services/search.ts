/**
 * Search service
 * Wraps Gemini File Search for semantic queries
 */

import * as supabase from '../clients/supabase.js';
import * as gemini from '../clients/gemini.js';
import { loggers } from '../utils/logger.js';
import { normalizeDomain, extractBaseDomain } from '../utils/url.js';
import { validateSearchInput } from './search-validation.js';
import type { SearchResult } from '../types/index.js';

const log = loggers.search;

/**
 * Ask a question and get an answer grounded in website content
 *
 * This is the main search function that uses Gemini File Search
 * to find relevant content and generate a grounded answer.
 * 
 * @param question - The question to ask about the website content
 * @param websiteDomain - The website domain (can be URL, domain, or domain with extra text)
 *                        Examples: "example.com", "https://www.example.com", "www.example.com/path"
 * @returns Search result with answer and sources
 */
export async function askQuestion(
  question: string,
  websiteDomain: string
): Promise<SearchResult> {
  // ========================================================================
  // STEP 1: INPUT VALIDATION (Production-grade validation with Zod)
  // ========================================================================
  try {
    const validated = validateSearchInput(question, websiteDomain);
    question = validated.question;
    websiteDomain = validated.websiteDomain;
  } catch (validationError) {
    const message = validationError instanceof Error ? validationError.message : 'Invalid input';
    log.error({ question, websiteDomain, error: message }, 'Input validation failed');
    throw new Error(`Invalid search input: ${message}`);
  }

  // ========================================================================
  // STEP 2: NORMALIZE DOMAIN (Extract clean domain from input)
  // ========================================================================
  // Extract domain from URL/string, then get base domain (removes www)
  // This matches ingestion logic: www.example.com and example.com resolve to same website
  const extractedDomain = normalizeDomain(websiteDomain);
  const baseDomain = extractBaseDomain(extractedDomain);
  
  log.info({ 
    originalDomain: websiteDomain, 
    extractedDomain,
    baseDomain,
    question: question.slice(0, 100) 
  }, 'Processing question');

  // ========================================================================
  // STEP 3: LOOKUP WEBSITE BY BASE DOMAIN
  // ========================================================================
  // Use base domain lookup (same as ingestion) to handle www vs non-www
  const website = await supabase.getWebsiteByDomain(baseDomain);
  
  if (!website) {
    throw new Error(
      `Website not found for domain: ${baseDomain}. ` +
      `The domain "${websiteDomain}" has not been indexed yet. ` +
      `Would you like to index it? Please run ingestion first.`
    );
  }

  if (!website.gemini_store_id) {
    throw new Error(
      `Website "${baseDomain}" has no Gemini File Search store. ` +
      `Please run indexing to create the store.`
    );
  }

  log.info(
    { 
      websiteId: website.id, 
      domain: website.domain,
      storeId: website.gemini_store_id 
    },
    'Website found, executing search'
  );

  // ========================================================================
  // STEP 4: EXECUTE SEARCH
  // ========================================================================
  const response = await gemini.searchWithFileSearch(
    website.gemini_store_id,
    question
  );

  // Map sources to include URL info
  const sources = response.sources.map((source) => ({
    url: source.uri ?? '',
    title: source.title ?? '',
    snippet: undefined,
  }));

  log.info(
    { 
      websiteId: website.id, 
      domain: website.domain,
      sourceCount: sources.length 
    },
    'Question answered'
  );

  return {
    answer: response.answer,
    sources,
    websiteId: website.id,
  };
}

/**
 * Check if the website has existing content about a topic
 *
 * Useful for marketing/content teams to avoid duplicate content.
 * Example: "Have we already written a blog about X?"
 */
export async function checkExistingContent(
  query: string,
  websiteDomain: string
): Promise<{
  hasExistingContent: boolean;
  answer: string;
  relevantPages: Array<{ url: string; title: string }>;
  websiteId: string;
}> {
  log.info({ query: query.slice(0, 100), websiteDomain }, 'Checking existing content');

  const prompt = `Based on the indexed website content, answer this question:

Does this website have existing content about: "${query}"?

If yes:
1. List the specific pages that cover this topic with their URLs
2. Briefly describe what each page covers
3. Rate the coverage: comprehensive, partial, or minimal

If no:
1. Explain what related content exists (if any)
2. Suggest what topics this new content could cover

Be specific and cite the actual pages from the website.`;

  const result = await askQuestion(prompt, websiteDomain);

  // Determine if content exists based on response
  const lowerAnswer = result.answer.toLowerCase();
  const hasExistingContent =
    (lowerAnswer.includes('yes') || lowerAnswer.includes('found')) &&
    !lowerAnswer.startsWith('no') &&
    result.sources.length > 0;

  return {
    hasExistingContent,
    answer: result.answer,
    relevantPages: result.sources,
    websiteId: result.websiteId,
  };
}

/**
 * Search with a specific filter (e.g., only blog posts, only product pages)
 */
export async function searchWithFilter(
  question: string,
  filter: {
    pathPrefix?: string;
    websiteDomain: string;
  }
): Promise<SearchResult> {
  log.info({ question: question.slice(0, 100), filter }, 'Filtered search');

  // Normalize domain to base domain (same as ingestion)
  const extractedDomain = normalizeDomain(filter.websiteDomain);
  const baseDomain = extractBaseDomain(extractedDomain);

  // Get website by base domain
  const website = await supabase.getWebsiteByDomain(baseDomain);
  if (!website) {
    throw new Error(
      `Website not found for domain: ${baseDomain}. ` +
      `The domain "${filter.websiteDomain}" has not been indexed yet. ` +
      `Would you like to index it? Please run ingestion first.`
    );
  }

  if (!website.gemini_store_id) {
    throw new Error('Website has no Gemini File Search store');
  }

  // Build metadata filter if path prefix provided
  let metadataFilter: string | undefined;
  if (filter.pathPrefix) {
    // Use Gemini's metadata filter syntax
    metadataFilter = `path LIKE "${filter.pathPrefix}%"`;
  }

  // Execute filtered search
  const response = await gemini.searchWithFileSearch(
    website.gemini_store_id,
    question,
    { metadataFilter }
  );

  return {
    answer: response.answer,
    sources: response.sources.map((s) => ({
      url: s.uri ?? '',
      title: s.title ?? '',
    })),
    websiteId: website.id,
  };
}

/**
 * Get a summary of website content for a specific topic
 */
export async function summarizeTopic(
  topic: string,
  websiteDomain: string
): Promise<{
  summary: string;
  sources: Array<{ url: string; title: string }>;
  websiteId: string;
}> {
  const prompt = `Summarize all the website's content related to: "${topic}"

Include:
1. Main points covered across all relevant pages
2. Key products, services, or features mentioned (if applicable)
3. Unique insights or perspectives from the content
4. Any gaps in coverage

Base your summary only on the actual website content. Cite the specific pages used.`;

  const result = await askQuestion(prompt, websiteDomain);

  return {
    summary: result.answer,
    sources: result.sources,
    websiteId: result.websiteId,
  };
}

/**
 * Find pages that mention specific products, services, or keywords
 */
export async function findMentions(
  keywords: string[],
  websiteDomain: string
): Promise<{
  answer: string;
  pages: Array<{ url: string; title: string }>;
  websiteId: string;
}> {
  const keywordList = keywords.join(', ');

  const prompt = `Find all pages on this website that mention any of these: ${keywordList}

For each page found:
1. List the page URL and title
2. Briefly explain how it relates to the keywords
3. Quote a short relevant excerpt if possible

If no pages mention these keywords, say so clearly.`;

  const result = await askQuestion(prompt, websiteDomain);

  return {
    answer: result.answer,
    pages: result.sources,
    websiteId: result.websiteId,
  };
}

