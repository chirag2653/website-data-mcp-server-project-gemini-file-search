# Sync Service Plan

## Executive Summary

This document outlines the sync service architecture for detecting new pages, handling content changes, and managing the Gemini File Search store. Based on research, **Gemini File Search API does NOT support document updates** - to modify content, we must DELETE the old document and UPLOAD a new one.

---

## Gemini File Search API Constraints

### Available Document Operations
| Operation | Endpoint | Description |
|-----------|----------|-------------|
| CREATE | `POST /upload/v1beta/{store}:uploadToFileSearchStore` | Upload new document |
| DELETE | `DELETE /v1beta/{documentName}` | Remove document |
| GET | `GET /v1beta/{documentName}` | Retrieve document info |
| LIST | `GET /v1beta/{store}/documents` | List all documents |

### Critical Limitation
**NO PATCH/UPDATE operation exists.** To update a document's content:
1. DELETE the existing document
2. UPLOAD the new content as a new document

This is confirmed by [Google's official documentation](https://ai.google.dev/api/file-search/documents).

---

## Page Lifecycle & Status Flow

```
                    ┌─────────────────────────────────────────────────────────────┐
                    │                      PAGE LIFECYCLE                          │
                    └─────────────────────────────────────────────────────────────┘

    ┌─────────┐      ┌───────────────────┐      ┌────────────┐      ┌────────┐
    │ pending │ ───► │ ready_for_indexing│ ───► │ processing │ ───► │ active │
    └─────────┘      └───────────────────┘      └────────────┘      └────────┘
         │                    │                       │                  │
         │                    │                       │                  │
         ▼                    ▼                       ▼                  ▼
    ┌─────────┐          ┌─────────┐            ┌─────────┐        ┌─────────┐
    │  error  │          │  error  │            │  error  │        │ deleted │
    └─────────┘          └─────────┘            └─────────┘        └─────────┘
```

### Status Definitions

| Status | Description | Markdown Content | Gemini Doc |
|--------|-------------|------------------|------------|
| `pending` | URL discovered, not yet scraped | No | No |
| `ready_for_indexing` | Scraped, markdown stored, awaiting indexing | Yes | No |
| `processing` | Currently being indexed to Gemini | Yes | Uploading |
| `active` | Successfully indexed and searchable | Yes | Yes (ACTIVE) |
| `error` | Failed to process | Maybe | Maybe |
| `deleted` | Marked for removal | Maybe | No |
| `redirect` | URL redirects elsewhere | No | No |

---

## Sync Service Flow

### Phase 0: Self-Healing (Retry Logic)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 0: SELF-HEALING                                                       │
│                                                                             │
│ Find pages with status = 'pending' | 'processing' | 'error'                 │
│                                                                             │
│ ┌─────────────────────────────┐    ┌─────────────────────────────┐         │
│ │ Has markdown_content?       │    │ No markdown_content?        │         │
│ │                             │    │                             │         │
│ │ → Set status='processing'   │    │ → Batch re-scrape           │         │
│ │ → Indexing will pick up     │    │ → Write to DB               │         │
│ │                             │    │ → Set status='ready_for_    │         │
│ │                             │    │   indexing'                 │         │
│ └─────────────────────────────┘    └─────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 1: URL Categorization (The "Diff")

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 1: URL CATEGORIZATION                                                 │
│                                                                             │
│ 1. Run FireCrawl /map to get current URLs                                   │
│ 2. Compare with database pages                                              │
│                                                                             │
│ ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐              │
│ │ NEW URLs        │  │ EXISTING URLs   │  │ MISSING URLs    │              │
│ │                 │  │                 │  │                 │              │
│ │ In map,         │  │ In both map     │  │ In DB,          │              │
│ │ NOT in DB       │  │ AND DB          │  │ NOT in map      │              │
│ └────────┬────────┘  └────────┬────────┘  └────────┬────────┘              │
│          │                    │                    │                        │
│          ▼                    ▼                    ▼                        │
│   Batch scrape         Batch scrape         Increment                       │
│   Write to DB          Compare hashes       missing_count                   │
│   status='processing'                                                       │
│                        ┌────────┴────────┐                                 │
│                        │                 │                                  │
│                        ▼                 ▼                                  │
│                   UNCHANGED          CHANGED                                │
│                   Update timestamps  DELETE old Gemini doc                  │
│                   Reset missing_cnt  Write new markdown                     │
│                                      status='processing'                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 2: Threshold-Based Deletion

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 2: DELETION                                                           │
│                                                                             │
│ Only delete pages where missing_count >= threshold (default: 3)             │
│                                                                             │
│ This prevents false deletions from:                                         │
│ - Temporary site outages                                                    │
│ - Network errors                                                            │
│ - FireCrawl map inconsistencies                                             │
│                                                                             │
│ For each page past threshold:                                               │
│ 1. DELETE document from Gemini (if gemini_file_id exists)                   │
│ 2. Set status='deleted'                                                     │
│ 3. Clear gemini_file_id and gemini_file_name                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Phase 3: Trigger Indexing (Fire-and-Forget)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ PHASE 3: INDEXING TRIGGER                                                   │
│                                                                             │
│ After scraping phase completes:                                             │
│                                                                             │
│ 1. Trigger indexing service asynchronously (don't await)                    │
│ 2. Indexing service picks up pages with status='ready_for_indexing'         │
│    OR status='processing'                                                   │
│ 3. Uploads markdown to Gemini                                               │
│ 4. Verifies document state (ACTIVE/PROCESSING/FAILED)                       │
│ 5. Only sets status='active' when Gemini confirms ACTIVE                    │
│                                                                             │
│ Sync completes independently - indexing runs in background                  │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Content Change Detection

### Hash-Based Change Detection

```typescript
// SHA256 hash of normalized markdown content
const contentHash = computeContentHash(markdown);

// Compare with stored hash
const changed = newHash !== page.content_hash;
```

### Change Handling Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ CONTENT CHANGE HANDLING                                                     │
│                                                                             │
│ 1. Scrape page via FireCrawl                                                │
│ 2. Compute SHA256 hash of new content                                       │
│ 3. Compare with stored content_hash                                         │
│                                                                             │
│ If CHANGED:                                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ a. DELETE old Gemini document (if gemini_file_id exists)                │ │
│ │    - Call: DELETE /v1beta/{gemini_file_id}                              │ │
│ │    - Ignore 404 errors (doc may already be gone)                        │ │
│ │                                                                         │ │
│ │ b. UPDATE database record:                                              │ │
│ │    - status = 'processing'                                              │ │
│ │    - content_hash = newHash                                             │ │
│ │    - markdown_content = newMarkdown                                     │ │
│ │    - gemini_file_id = NULL (clear old reference)                        │ │
│ │    - gemini_file_name = NULL                                            │ │
│ │                                                                         │ │
│ │ c. Indexing service will:                                               │ │
│ │    - UPLOAD new content to Gemini                                       │ │
│ │    - Set new gemini_file_id                                             │ │
│ │    - Set status = 'active' when confirmed                               │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ If UNCHANGED:                                                               │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ - Update last_scraped timestamp                                         │ │
│ │ - Update last_seen timestamp                                            │ │
│ │ - Reset missing_count = 0                                               │ │
│ │ - Increment firecrawl_scrape_count                                      │ │
│ │ - NO Gemini operations needed                                           │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Gemini Document Update Pattern

Since Gemini does not support PATCH/UPDATE, we use DELETE + UPLOAD:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ DELETE + UPLOAD PATTERN                                                     │
│                                                                             │
│ Step 1: Delete Old Document                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ DELETE /v1beta/fileSearchStores/{store}/documents/{doc-id}              │ │
│ │                                                                         │ │
│ │ - Returns 200 OK on success                                             │ │
│ │ - Returns 404 if already deleted (treat as success)                     │ │
│ │ - Document is removed from search index                                 │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Step 2: Upload New Document                                                 │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ POST /upload/v1beta/fileSearchStores/{store}:uploadToFileSearchStore    │ │
│ │                                                                         │ │
│ │ Body: multipart/form-data                                               │ │
│ │   - metadata: { displayName: "Page Title" }                             │ │
│ │   - file: markdown content                                              │ │
│ │                                                                         │ │
│ │ Response includes:                                                      │ │
│ │   - name: new document ID                                               │ │
│ │   - state: ACTIVE | PROCESSING | PENDING                                │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Step 3: Verify Document State                                               │
│ ┌─────────────────────────────────────────────────────────────────────────┐ │
│ │ GET /v1beta/fileSearchStores/{store}/documents/{new-doc-id}             │ │
│ │                                                                         │ │
│ │ - state = 'ACTIVE': Document ready, update page status='active'         │ │
│ │ - state = 'PROCESSING': Still processing, retry verification later     │ │
│ │ - state = 'FAILED': Upload failed, delete and retry                     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Database State Management

### Pages Table Key Fields

| Field | Purpose | Set By |
|-------|---------|--------|
| `status` | Page lifecycle state | Ingestion/Sync/Indexing |
| `content_hash` | SHA256 for change detection | Ingestion/Sync |
| `markdown_content` | Stored scraped content | Ingestion/Sync |
| `gemini_file_id` | Document ID in Gemini | Indexing |
| `gemini_file_name` | Display name in Gemini | Indexing |
| `missing_count` | Consecutive syncs without URL | Sync |
| `last_seen` | Last time URL found in map | Sync |
| `last_scraped` | Last time content scraped | Ingestion/Sync |

### Status Transitions

```
                    Ingestion                      Indexing
                    ─────────                      ────────
New URL found   →   pending → ready_for_indexing → processing → active

                    Sync                           Indexing
                    ────                           ────────
Content changed →   active → processing         → processing → active

                    Sync
                    ────
URL missing     →   increment missing_count (stays active until threshold)

                    Sync
                    ────
Past threshold  →   active → deleted (Gemini doc deleted)
```

---

## Error Handling & Recovery

### Retry Scenarios

| Scenario | Detection | Recovery |
|----------|-----------|----------|
| Scrape failed | status='error', no markdown | Re-scrape in next sync |
| Upload failed | status='processing', no gemini_file_id | Re-upload in indexing |
| Gemini FAILED state | Verified via GET | Delete doc, keep status='ready_for_indexing' |
| Gemini PROCESSING | Verified via GET | Delete doc, retry next indexing run |

### Idempotency

All operations are designed to be idempotent:
- DELETE on already-deleted doc returns 404 (ignored)
- Re-scraping same content produces same hash (no change detected)
- Re-uploading same content creates new doc ID (old one already deleted)

---

## Current Implementation Status

### What's Already Implemented

1. **Phase 0 (Self-Healing)**: Lines 68-170 in `sync.ts`
   - Finds incomplete pages
   - Separates pages with/without markdown
   - Re-scrapes pages missing content

2. **Phase 1 (Categorization)**: Lines 172-444 in `sync.ts`
   - URL discovery via FireCrawl /map
   - NEW/EXISTING/MISSING categorization
   - Hash-based change detection
   - DELETE + status update for changed pages

3. **Phase 2 (Deletion)**: Lines 456-478 in `sync.ts`
   - Threshold-based deletion (default: 3)
   - Gemini document cleanup
   - Status update to 'deleted'

4. **Phase 3 (Indexing)**: Lines 502-526 in `sync.ts`
   - Fire-and-forget indexing trigger
   - Async execution (doesn't block sync)

### What Needs Review/Enhancement

1. **Status Consistency**: Sync uses `status='processing'` for new pages, but should use `status='ready_for_indexing'` to be consistent with ingestion.

2. **Indexing Pickup**: Verify indexing service queries both `ready_for_indexing` AND `processing` statuses.

3. **Document State Tracking**: Ensure `process_jobs.metadata.documentStates` is properly updated.

---

## Recommendations

### Short-Term

1. **Align Status Usage**: Both ingestion and sync should set `status='ready_for_indexing'` after scraping, NOT `status='processing'`. Processing status should only be set BY the indexing service when it starts uploading.

2. **Add Logging**: Add detailed logging for DELETE + UPLOAD operations to trace content changes.

3. **Batch Optimization**: Group DELETE operations before UPLOAD operations to avoid rate limiting issues.

### Long-Term

1. **Scheduled Syncs**: Implement cron-based automatic sync (e.g., daily/weekly).

2. **Webhook Integration**: Add webhook support for real-time content change notifications.

3. **Incremental Indexing**: Instead of re-indexing entire changed pages, consider if partial updates become available in future Gemini API versions.

---

## References

- [Gemini File Search Stores API](https://ai.google.dev/api/file-search/file-search-stores)
- [Gemini Documents API](https://ai.google.dev/api/file-search/documents)
- [Gemini File Search Overview](https://ai.google.dev/gemini-api/docs/file-search)
- [Google Developers Blog - File Search Tool](https://blog.google/technology/developers/file-search-gemini-api/)
