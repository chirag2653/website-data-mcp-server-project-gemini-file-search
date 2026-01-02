# Domain and Store Implementation Summary

## ✅ Completed Changes

### 1. Domain/Subdomain Logic

**New Functions in `src/utils/url.ts`:**
- `extractBaseDomain(domain)`: Extracts base domain, normalizes www
  - `www.example.com` → `example.com`
  - `example.com` → `example.com`
  - `subdomain.example.com` → `subdomain.example.com` (different website)
- `isSameBaseDomain(domain1, domain2)`: Checks if two domains share base domain

**Logic:**
- Same base domain (e.g., `example.com`, `www.example.com`) = Same website ID
- Different subdomains (e.g., `subdomain.example.com`) = Different websites
- Base domain is stored in database (normalized)

### 2. Ingestion Only Creates Website

**Updated `src/services/ingestion.ts`:**
- ✅ Only ingestion service can register new website
- ✅ Checks by base domain (prevents duplicates)
- ✅ If website exists → automatically switches to sync
- ✅ New function: `checkWebsiteExists(seedUrl)` - checks domain resolution

**Domain Resolution:**
- If user passes `https://www.example.com/path`, extracts base domain `example.com`
- Checks if website with base domain exists
- Returns: `{ exists: true, website, action: 'sync' }` or `{ exists: false, action: 'ingest' }`

### 3. Sync Requires Existing Website

**Updated `src/services/sync.ts`:**
- ✅ Verifies website exists
- ✅ Verifies website has at least one page (must be ingested first)
- ✅ Verifies website has Gemini store (should always exist after ingestion)
- ✅ Throws clear error if website not ingested

### 4. File Store Creation

**Updated `src/services/ingestion.ts`:**
- ✅ Store created **during website registration** (before website record)
- ✅ Store ID stored in website record immediately
- ✅ One store per website ID
- ✅ Store name: `website-{baseDomain}-{timestamp}`

**Flow:**
```
1. Extract base domain from seed URL
2. Check if website exists (by base domain)
3. If not exists:
   a. Create Gemini File Search store
   b. Create website record with store_id
   c. Proceed with ingestion
4. If exists:
   a. Return existing website
   b. Suggest sync
```

### 5. Schema Verification

**Current Schema (`supabase/migrations/001_initial_schema.sql`):**
- ✅ `websites.gemini_store_id` - TEXT (nullable initially, set during ingestion)
- ✅ `websites.gemini_store_name` - TEXT
- ✅ `websites.domain` - TEXT NOT NULL (stores base domain)

**No schema changes needed** - current schema supports the requirements.

### 6. Individual URL Service

**Updated `src/services/individual-url.ts`:**
- ✅ Uses base domain matching (not exact domain)
- ✅ Validates URL base domain matches website base domain

## Key Functions

### `checkWebsiteExists(seedUrl: string)`
```typescript
// Usage: Check if website exists before ingestion
const check = await checkWebsiteExists('https://www.example.com/path');
if (check.exists) {
  // Website exists - use sync
  await syncWebsite(check.website.id);
} else {
  // New website - use ingestion
  await ingestWebsite(seedUrl);
}
```

### `extractBaseDomain(domain: string)`
```typescript
extractBaseDomain('www.example.com') // → 'example.com'
extractBaseDomain('example.com')      // → 'example.com'
extractBaseDomain('subdomain.example.com') // → 'subdomain.example.com'
```

## Architecture Compliance

✅ **Ingestion**: Only service that creates website ID
✅ **Sync**: Requires existing website with pages
✅ **Domain Deduplication**: Base domain matching prevents duplicates
✅ **Store Creation**: During website registration (ingestion)
✅ **One Store Per Website**: Enforced by creation during registration

## Testing Checklist

- [ ] Test: `www.example.com` and `example.com` → same website ID
- [ ] Test: `subdomain.example.com` → different website ID
- [ ] Test: Ingestion creates store during registration
- [ ] Test: Sync fails if website has no pages
- [ ] Test: Domain resolution with paths/queries works
- [ ] Test: Individual URL validates base domain match

