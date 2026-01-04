/**
 * Gemini File Search client for semantic indexing and retrieval
 */
import { GoogleGenAI } from '@google/genai';
import type { GeminiFileSearchStore, GeminiFileUploadResult, GeminiSearchResponse, GeminiFileMetadata } from '../types/index.js';
declare const genai: GoogleGenAI;
/**
 * Create a new File Search store
 */
export declare function createFileSearchStore(displayName: string): Promise<GeminiFileSearchStore>;
/**
 * Get a File Search store by name
 * Returns store information including document counts
 */
export declare function getFileSearchStore(name: string): Promise<GeminiFileSearchStore | null>;
/**
 * List documents in a File Search store
 * According to API docs: https://ai.google.dev/api/file-search/documents
 * The SDK returns a Pager - we'll use it to get all documents
 */
export declare function listDocumentsInStore(storeName: string, options?: {
    maxResults?: number;
}): Promise<{
    documents: Array<{
        name: string;
        displayName?: string;
        mimeType?: string;
        sizeBytes?: string;
        createTime?: string;
        updateTime?: string;
        state?: string;
    }>;
    totalCount: number;
}>;
/**
 * Delete a File Search store
 */
export declare function deleteFileSearchStore(name: string): Promise<void>;
/**
 * Upload content directly to a File Search store
 */
export declare function uploadToFileSearchStore(storeName: string, content: string, metadata: GeminiFileMetadata): Promise<GeminiFileUploadResult>;
/**
 * Delete a document from File Search store
 *
 * According to Gemini API docs: https://ai.google.dev/api/file-search/documents
 * Uses fileSearchStores.documents.delete() method
 *
 * @param storeName - The FileSearchStore name (e.g., "fileSearchStores/my-store-123")
 * @param documentName - The full document name (e.g., "fileSearchStores/my-store-123/documents/doc-abc")
 *                       OR just the document ID (will be constructed if needed)
 */
export declare function deleteFileFromStore(storeName: string, documentName: string): Promise<void>;
/**
 * Query the File Search store with a question
 *
 * @param storeName - The File Search store name
 * @param question - The question to ask
 * @param options - Optional configuration
 * @param options.metadataFilter - Filter documents by metadata (JSON string)
 *
 * @returns Search response with answer, citations, and grounding metadata
 *
 * @note Chunk Limitation:
 * - Gemini typically returns ~5 chunks from 2-3 unique documents per query
 * - There is NO documented parameter to control or increase chunk count
 * - This is a known API limitation (see: https://discuss.ai.google.dev/t/investigating-undocumented-file-search-retrieval-limits)
 * - The API manages retrieval internally based on relevance
 */
export declare function searchWithFileSearch(storeName: string, question: string, options?: {
    metadataFilter?: string;
}): Promise<GeminiSearchResponse>;
/**
 * Search with structured output
 */
export declare function searchWithStructuredOutput<T>(storeName: string, question: string, schema: Record<string, unknown>): Promise<{
    data: T;
    sources: GeminiSearchResponse['sources'];
}>;
export { genai };
//# sourceMappingURL=gemini.d.ts.map