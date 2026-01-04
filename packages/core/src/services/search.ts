/**
 * Search service
 * Wraps Gemini File Search for semantic queries
 */

import * as supabase from '../clients/supabase.js';
import * as gemini from '../clients/gemini.js';
import { loggers } from '../utils/logger.js';
import { normalizeDomain, extractBaseDomain } from '../utils/url.js';
import { z } from 'zod';
import type { SearchResult } from '../types/index.js';

const log = loggers.search;

/**
 * Clean and format answer text for better presentation
 * Removes excessive formatting, normalizes whitespace, and ensures clean output
 */
function cleanAnswer(answer: string | null | undefined): string {
  // Handle null/undefined/empty cases
  if (!answer || typeof answer !== 'string') {
    return '';
  }
  
  // Remove excessive newlines (more than 2 consecutive)
  let cleaned = answer.replace(/\n{3,}/g, '\n\n');
  
  // Remove excessive spaces
  cleaned = cleaned.replace(/[ \t]{3,}/g, ' ');
  
  // Trim each line
  cleaned = cleaned
    .split('\n')
    .map(line => line.trim())
    .join('\n');
  
  // Remove leading/trailing whitespace
  cleaned = cleaned.trim();
  
  return cleaned;
}

/**
 * Ask a question and get an answer grounded in website content
 *
 * This is the main search function that uses Gemini File Search
 * to find relevant content and generate a grounded answer.
 * 
 * @param question - The question to ask about the website content (max 5000 chars)
 * @param websiteUrl - The website URL (can be full URL, domain, or domain with path)
 *                     Examples: "https://example.com", "example.com", "www.example.com/path"
 * @returns Search result with clean answer and citations
 */
export async function askQuestion(
  question: string,
  websiteUrl: string
): Promise<SearchResult> {
  // ========================================================================
  // STEP 1: INPUT VALIDATION WITH ZOD
  // ========================================================================
  try {
    // Validate question - any string with length constraints
    const questionSchema = z
      .string({
        required_error: 'Question is required',
        invalid_type_error: 'Question must be a string',
      })
      .min(1, 'Question cannot be empty')
      .max(5000, 'Question must be 5000 characters or less')
      .trim();
    
    question = questionSchema.parse(question);
    
    // Validate URL - must contain a valid URL or domain
    const urlSchema = z
      .string({
        required_error: 'Website URL is required',
        invalid_type_error: 'Website URL must be a string',
      })
      .min(1, 'Website URL cannot be empty')
      .refine(
        (input) => {
          // Check if it contains a valid URL pattern
          // Accepts: http://example.com, https://example.com, example.com, www.example.com
          const urlPattern = /^(https?:\/\/)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(\/.*)?$/i;
          return urlPattern.test(input.trim());
        },
        { message: 'Please provide a valid URL (e.g., https://example.com or example.com)' }
      );
    
    websiteUrl = urlSchema.parse(websiteUrl);
  } catch (validationError) {
    if (validationError instanceof z.ZodError) {
      const firstError = validationError.errors[0];
      const message = firstError?.message || 'Invalid input';
      log.error({ question, websiteUrl, error: message }, 'Input validation failed');
      throw new Error(message);
    }
    const message = validationError instanceof Error ? validationError.message : 'Invalid input';
    log.error({ question, websiteUrl, error: message }, 'Input validation failed');
    throw new Error(message);
  }

  // ========================================================================
  // STEP 2: NORMALIZE DOMAIN (Extract root domain from URL)
  // ========================================================================
  // Extract domain from URL/string, then get base domain (removes www)
  // This matches ingestion logic: www.example.com and example.com resolve to same website
  const extractedDomain = normalizeDomain(websiteUrl);
  const baseDomain = extractBaseDomain(extractedDomain);
  
  // Validate that we got a valid domain after normalization
  if (!baseDomain || baseDomain.trim().length === 0) {
    throw new Error('Could not extract a valid domain from the provided URL. Please provide a valid URL (e.g., https://example.com or example.com)');
  }
  
  log.info({ 
    originalUrl: websiteUrl, 
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
      `This domain (${baseDomain}) has never been indexed. ` +
      `Would you like to index and ingest this domain?`
    );
  }

  // ========================================================================
  // STEP 4: CHECK FILE STORE EXISTS
  // ========================================================================
  if (!website.gemini_store_id) {
    throw new Error(
      `This domain (${baseDomain}) has been ingested but not yet indexed. ` +
      `Would you like to index and ingest this domain?`
    );
  }

  log.info(
    { 
      websiteId: website.id, 
      domain: website.domain,
      storeId: website.gemini_store_id 
    },
    'Website found with file store, executing search'
  );

  // ========================================================================
  // STEP 5: EXECUTE SEARCH
  // ========================================================================
  const response = await gemini.searchWithFileSearch(
    website.gemini_store_id,
    question
  );

  // ========================================================================
  // STEP 6: FORMAT RESPONSE
  // ========================================================================
  // Clean and format the answer for better presentation
  const cleanedAnswer = cleanAnswer(response.answer);
  
  // Handle empty answer case
  if (!cleanedAnswer || cleanedAnswer.trim().length === 0) {
    log.warn(
      { websiteId: website.id, domain: website.domain },
      'Empty answer received from Gemini'
    );
  }

  // Map sources to include URL info (citations)
  const citations = (response.sources || []).map((source) => ({
    url: source.uri ?? '',
    title: source.title ?? '',
    snippet: undefined, // Can be populated later if needed
  }));
  
  if (citations.length === 0) {
    log.warn(
      { websiteId: website.id, domain: website.domain },
      'No citations found in search response'
    );
  }

  log.info(
    { 
      websiteId: website.id, 
      domain: website.domain,
      citationCount: citations.length 
    },
    'Question answered successfully'
  );

  return {
    answer: cleanedAnswer,
    sources: citations,
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
  // Validate question input (same validation as askQuestion)
  try {
    const questionSchema = z
      .string({
        required_error: 'Question is required',
        invalid_type_error: 'Question must be a string',
      })
      .min(1, 'Question cannot be empty')
      .max(5000, 'Question must be 5000 characters or less')
      .trim();
    
    question = questionSchema.parse(question);
  } catch (validationError) {
    if (validationError instanceof z.ZodError) {
      const firstError = validationError.errors[0];
      const message = firstError?.message || 'Invalid question';
      log.error({ question, error: message }, 'Question validation failed');
      throw new Error(message);
    }
    throw validationError;
  }
  
  log.info({ question: question.slice(0, 100), filter }, 'Filtered search');

  // Normalize domain to base domain (same as ingestion)
  const extractedDomain = normalizeDomain(filter.websiteDomain);
  const baseDomain = extractBaseDomain(extractedDomain);
  
  // Validate that we got a valid domain after normalization
  if (!baseDomain || baseDomain.trim().length === 0) {
    throw new Error('Could not extract a valid domain from the provided URL. Please provide a valid URL (e.g., https://example.com or example.com)');
  }

  // Get website by base domain
  const website = await supabase.getWebsiteByDomain(baseDomain);
  if (!website) {
    throw new Error(
      `This domain (${baseDomain}) has never been indexed. ` +
      `Would you like to index and ingest this domain?`
    );
  }

  if (!website.gemini_store_id) {
    throw new Error(
      `This domain (${baseDomain}) has been ingested but not yet indexed. ` +
      `Would you like to index and ingest this domain?`
    );
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

  // Clean and format the answer
  const cleanedAnswer = cleanAnswer(response.answer);
  
  // Handle empty answer case
  if (!cleanedAnswer || cleanedAnswer.trim().length === 0) {
    log.warn(
      { websiteId: website.id, domain: website.domain },
      'Empty answer received from Gemini in filtered search'
    );
  }

  return {
    answer: cleanedAnswer,
    sources: (response.sources || []).map((s) => ({
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

