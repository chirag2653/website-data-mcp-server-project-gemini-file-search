/**
 * Search service
 * Wraps Gemini File Search for semantic queries
 */
import type { SearchResult } from '../types/index.js';
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
export declare function askQuestion(question: string, websiteDomain: string): Promise<SearchResult>;
/**
 * Check if the website has existing content about a topic
 *
 * Useful for marketing/content teams to avoid duplicate content.
 * Example: "Have we already written a blog about X?"
 */
export declare function checkExistingContent(query: string, websiteDomain: string): Promise<{
    hasExistingContent: boolean;
    answer: string;
    relevantPages: Array<{
        url: string;
        title: string;
    }>;
    websiteId: string;
}>;
/**
 * Search with a specific filter (e.g., only blog posts, only product pages)
 */
export declare function searchWithFilter(question: string, filter: {
    pathPrefix?: string;
    websiteDomain: string;
}): Promise<SearchResult>;
/**
 * Get a summary of website content for a specific topic
 */
export declare function summarizeTopic(topic: string, websiteDomain: string): Promise<{
    summary: string;
    sources: Array<{
        url: string;
        title: string;
    }>;
    websiteId: string;
}>;
/**
 * Find pages that mention specific products, services, or keywords
 */
export declare function findMentions(keywords: string[], websiteDomain: string): Promise<{
    answer: string;
    pages: Array<{
        url: string;
        title: string;
    }>;
    websiteId: string;
}>;
//# sourceMappingURL=search.d.ts.map