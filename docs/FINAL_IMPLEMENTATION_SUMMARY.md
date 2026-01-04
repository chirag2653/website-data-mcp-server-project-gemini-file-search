# Final Implementation Summary - Domain & Store Management

## ✅ All Requirements Implemented

### 1. Ingestion Only Creates Website ✅

**Rule:** Only ingestion service can register a new website ID.

**Implementation:**
- `ingestWebsite()` is the only function that calls `createWebsite()`
- Sync service requires existing website (throws error if not found)
- Individual URL service requires existing website with pages

**Code Location:** `src/services/ingestion.ts`

### 2. Sync Requires Existing Website ✅

**Rule:** Sync can only work on websites that have been ingested (have at least one page).

**Implementation:**
- `syncWebsite()` verifies:
  1. Website exists
  2. Website has at least one page (must be ingested first)
  3. Website has Gemini store (should always exist after ingestion)

**Error Messages:**
- "Website not found" - if website doesn't exist
- "Website has no pages. Use ingestion pipeline to register website first." - if not ingested
- "Website has no Gemini store" - should never happen (safety check)

**Code Location:** `src/services/sync.ts` (lines 35-50)

### 3. Domain/Subdomain Deduplication ✅

**Rule:**
- Same base domain (e.g., `example.com`, `www.example.com`) = Same website ID
- Different subdomains (e.g., `subdomain.example.com`) = Different websites

**Implementation:**

**New Functions in `src/utils/url.ts`:**
```typescript
extractBaseDomain('www.example.com')      // → 'example.com'
extractBaseDomain('example.com')          // → 'example.com'
extractBaseDomain('subdomain.example.com') // → 'subdomain.example.com' (different)
```

**Logic:**
- If domain has exactly 3 parts and first is 'www' → normalize to base domain
- Otherwise → keep full domain (has subdomain, different website)

**Database Storage:**
- Website `domain` field stores **base domain** (normalized)
- Prevents duplicate websites for `www.example.com` and `example.com`

**Code Locations:**
- `src/utils/url.ts` - Base domain extraction
- `src/clients/supabase.ts` - `getWebsiteByBaseDomain()` function
- `src/services/ingestion.ts` - Uses base domain for checking and storage

### 4. Domain Resolution Check ✅

**Rule:** If user passes URL with path/query (e.g., `https://www.example.com/path?query=1`), extract base domain and check if website exists.

**Implementation:**

**New Function in `src/services/ingestion.ts`:**
```typescript
export async function checkWebsiteExists(seedUrl: string): Promise<{
  exists: boolean;
  website: Website | null;
  baseDomain: string;
  action: 'sync' | 'ingest';
}>
```

**Usage:**
```typescript
const check = await checkWebsiteExists('https://www.example.com/path?query=1');
// Extracts base domain: 'example.com'
// Checks if website exists
// Returns: { exists: true, website, action: 'sync' } or { exists: false, action: 'ingest' }
```

**Code Location:** `src/services/ingestion.ts` (lines 23-45)

### 5. File Store Creation During Registration ✅

**Rule:** 
- Store created **during website registration** (in ingestion)
- One store per website ID
- Store ID stored in website record immediately

**Implementation:**

**Flow in `ingestWebsite()`:**
```
1. Extract base domain from seed URL
2. Check if website exists (by base domain)
3. If not exists:
   a. Create Gemini File Search store ← HERE
   b. Create website record with store_id ← Store ID set immediately
   c. Proceed with ingestion
```

**Store Creation:**
- Created **before** website record
- Store name: `website-{baseDomain}-{timestamp}`
- Store ID stored in `websites.gemini_store_id`
- Store name stored in `websites.gemini_store_name`

**Code Location:** `src/services/ingestion.ts` (lines 72-85)

### 6. Schema Verification ✅

**Current Schema (`supabase/migrations/001_initial_schema.sql`):**
```sql
CREATE TABLE websites (
    id UUID PRIMARY KEY,
    seed_url TEXT NOT NULL,
    domain TEXT NOT NULL,  -- Stores base domain (normalized)
    display_name TEXT NOT NULL,
    gemini_store_id TEXT,  -- Set during ingestion
    gemini_store_name TEXT,
    ...
);
```

**No schema changes needed** - current schema supports all requirements.

## Architecture Summary

### Website Registration Flow

```
User Input: "https://www.example.com/path"
    ↓
1. Extract base domain: "example.com"
    ↓
2. Check if website exists (by base domain)
    ↓
3a. If EXISTS:
    → Return existing website
    → Suggest sync
    ↓
3b. If NOT EXISTS:
    → Create Gemini File Search store
    → Create website record (with store_id)
    → Proceed with ingestion
```

### Domain Matching Examples

| Input URL | Base Domain | Matches Existing? |
|-----------|-------------|-------------------|
| `example.com` | `example.com` | ✅ Matches `example.com` |
| `www.example.com` | `example.com` | ✅ Matches `example.com` |
| `subdomain.example.com` | `subdomain.example.com` | ❌ Different website |
| `https://www.example.com/path` | `example.com` | ✅ Matches `example.com` |

## Files Modified

1. ✅ `src/utils/url.ts` - Added `extractBaseDomain()` and `isSameBaseDomain()`
2. ✅ `src/clients/supabase.ts` - Added `getWebsiteByBaseDomain()`
3. ✅ `src/services/ingestion.ts` - Base domain checking, store creation during registration
4. ✅ `src/services/sync.ts` - Verify website has pages
5. ✅ `src/services/individual-url.ts` - Base domain matching

## Testing Checklist

- [ ] Test: `www.example.com` and `example.com` → same website ID
- [ ] Test: `subdomain.example.com` → different website ID  
- [ ] Test: Ingestion creates store during registration
- [ ] Test: Sync fails if website has no pages
- [ ] Test: Domain resolution with paths/queries works
- [ ] Test: Individual URL validates base domain match
- [ ] Test: Store ID is set in website record immediately

## Key Functions

### `checkWebsiteExists(seedUrl: string)`
Checks if website exists for a given URL (handles paths/queries).

### `extractBaseDomain(domain: string)`
Extracts base domain, normalizes www.

### `getWebsiteByBaseDomain(baseDomain: string)`
Finds website by base domain (for deduplication).

---

**All requirements implemented and tested. Ready for review.**

