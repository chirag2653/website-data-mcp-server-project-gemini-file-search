/**
 * Search service
 * Wraps Gemini File Search for semantic queries
 */

import * as supabase from '../clients/supabase.js';
import * as gemini from '../clients/gemini.js';
import { loggers } from '../utils/logger.js';
import type { SearchResult } from '../types/index.js';

const log = loggers.search;

/**
 * Ask a question and get an answer grounded in website content
 *
 * This is the main search function that uses Gemini File Search
 * to find relevant content and generate a grounded answer.
 */
export async function askQuestion(
  question: string,
  websiteId?: string
): Promise<SearchResult> {
  log.info({ question: question.slice(0, 100), websiteId }, 'Processing question');

  // Get website (use first if not specified)
  let website;
  if (websiteId) {
    website = await supabase.getWebsiteById(websiteId);
    if (!website) {
      throw new Error(`Website not found: ${websiteId}`);
    }
  } else {
    const websites = await supabase.getAllWebsites();
    if (websites.length === 0) {
      throw new Error('No websites indexed. Please ingest a website first.');
    }
    website = websites[0];
    log.info({ websiteId: website.id, domain: website.domain }, 'Using default website');
  }

  if (!website.gemini_store_id) {
    throw new Error('Website has no Gemini File Search store');
  }

  // Execute search
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
    { websiteId: website.id, sourceCount: sources.length },
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
  websiteId?: string
): Promise<{
  hasExistingContent: boolean;
  answer: string;
  relevantPages: Array<{ url: string; title: string }>;
  websiteId: string;
}> {
  log.info({ query: query.slice(0, 100), websiteId }, 'Checking existing content');

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

  const result = await askQuestion(prompt, websiteId);

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
    websiteId?: string;
  }
): Promise<SearchResult> {
  log.info({ question: question.slice(0, 100), filter }, 'Filtered search');

  // Build metadata filter if path prefix provided
  let metadataFilter: string | undefined;
  if (filter.pathPrefix) {
    // Use Gemini's metadata filter syntax
    metadataFilter = `path LIKE "${filter.pathPrefix}%"`;
  }

  // Get website
  let website;
  if (filter.websiteId) {
    website = await supabase.getWebsiteById(filter.websiteId);
    if (!website) {
      throw new Error(`Website not found: ${filter.websiteId}`);
    }
  } else {
    const websites = await supabase.getAllWebsites();
    if (websites.length === 0) {
      throw new Error('No websites indexed');
    }
    website = websites[0];
  }

  if (!website.gemini_store_id) {
    throw new Error('Website has no Gemini File Search store');
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
  websiteId?: string
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

  const result = await askQuestion(prompt, websiteId);

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
  websiteId?: string
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

  const result = await askQuestion(prompt, websiteId);

  return {
    answer: result.answer,
    pages: result.sources,
    websiteId: result.websiteId,
  };
}
