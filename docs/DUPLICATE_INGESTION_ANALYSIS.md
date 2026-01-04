# Duplicate Website Ingestion - Current Behavior & Recommendations

## Current Behavior

### What Happens When You Try to Ingest the Same Website Twice

**Location:** `src/services/ingestion.ts` lines 43-47

```typescript
// Check if website already exists
const existingWebsite = await supabase.getWebsiteByDomain(domain);
if (existingWebsite) {
  throw new Error(`Website for domain ${domain} already exists. Use sync to update.`);
}
```

**Result:**
- ❌ **Throws an error immediately** before any processing
- ❌ **No pages are created/updated** (fails before reaching that step)
- ❌ **No Gemini store is created** (fails before that step)
- ✅ **Prevents duplicate websites** in the database

### What Happens with Pages (if it got that far)

**Location:** `src/clients/supabase.ts` line 175

```typescript
.upsert(pages, { onConflict: 'website_id,url' })
```

**If pages were processed:**
- ✅ **Upsert behavior**: Pages with same `website_id` + `url` would be updated (not duplicated)
- ✅ **Safe**: No duplicate pages would be created

## The Problem

1. **Too Strict**: If ingestion partially failed, you can't retry without deleting the website first
2. **No Recovery Path**: If you want to re-ingest (maybe website structure changed), you must manually delete
3. **User Experience**: Error message is clear but doesn't offer options

## Recommended Behavior

### Option 1: Smart Auto-Sync (Recommended)
**Behavior:** If website exists, automatically use sync instead of failing

**Pros:**
- Seamless user experience
- No duplicate websites
- Automatically updates existing content

**Cons:**
- Might not be what user wants (maybe they want fresh start)
- Less explicit about what's happening

### Option 2: Force Flag
**Behavior:** Add a `force: true` parameter to allow re-ingestion

**Pros:**
- User has control
- Explicit about what's happening
- Allows fresh start when needed

**Cons:**
- Need to handle cleanup (delete old Gemini store, pages, etc.)
- More complex implementation

### Option 3: Hybrid Approach (Best)
**Behavior:** 
- If website exists → suggest using sync, but offer `force: true` option
- If `force: true` → delete old website and re-ingest fresh

**Pros:**
- Best of both worlds
- Clear user intent
- Handles all use cases

**Cons:**
- Most complex to implement

## Implementation Recommendation

I recommend **Option 3 (Hybrid)** with this behavior:

```typescript
export async function ingestWebsite(
  seedUrl: string,
  displayName?: string,
  options?: { force?: boolean }  // New optional parameter
): Promise<IngestionResult> {
  const existingWebsite = await supabase.getWebsiteByDomain(domain);
  
  if (existingWebsite) {
    if (options?.force) {
      // Force re-ingestion: Delete old website and start fresh
      log.info({ domain }, 'Force re-ingestion: Deleting existing website');
      await cleanupWebsite(existingWebsite.id);
      // Continue with normal ingestion
    } else {
      // Suggest using sync instead
      throw new Error(
        `Website for domain ${domain} already exists (ID: ${existingWebsite.id}). ` +
        `Use site_sync to update, or set force: true to re-ingest from scratch.`
      );
    }
  }
  
  // Continue with normal ingestion...
}
```

## Current Workaround

If you need to re-ingest right now:

1. **Use sync instead** (recommended):
   ```json
   {
     "websiteId": "existing-website-id"
   }
   ```
   This will update existing pages and add new ones.

2. **Manually delete and re-ingest**:
   - Delete the website record from Supabase
   - Delete the Gemini File Search store
   - Then run ingestion again

## What Should Happen (Ideal Behavior)

1. ✅ **Check if website exists** (current)
2. ✅ **If exists and no force flag** → Suggest using sync (improve error message)
3. ✅ **If exists and force flag** → Clean up old website and re-ingest
4. ✅ **If doesn't exist** → Normal ingestion (current)

## Next Steps

Would you like me to:
1. **Implement the hybrid approach** (force flag)?
2. **Improve the error message** to be more helpful?
3. **Add automatic sync fallback** (if website exists, use sync)?
4. **Keep current behavior** but document it better?

