# Ingestion Service - Production Grade Implementation

## ✅ Complete Flow Implementation

### **STEP 0: Input Validation (Zod)**
✅ **IMPLEMENTED**

- **Location**: `src/services/ingestion-validation.ts`
- **Validation**:
  - Validates input is a valid URL or domain
  - Accepts: `https://www.example.com`, `example.com`, `http://example.com/path`
  - Uses Zod schema for production-grade validation
  - Throws clear error if validation fails

**Code:**
```typescript
validateIngestionInput(seedUrl, displayName)
// Throws ZodError if invalid
```

---

### **STEP 1: Check if Website Already Exists**
✅ **IMPLEMENTED**

- **Location**: `src/services/ingestion.ts` (lines 97-125)
- **Logic**:
  1. Extracts exact domain from URL
  2. Checks Supabase for existing website by exact domain
  3. If exists → **Automatically routes to sync** (returns sync result)
  4. If not exists → Proceeds to registration

**Code:**
```typescript
const existingWebsite = await supabase.getWebsiteByDomain(domain);
if (existingWebsite) {
  // Automatically switch to sync
  const syncResult = await syncService.syncWebsite(existingWebsite.id);
  return syncResult; // In ingestion format
}
```

**Key Points:**
- ✅ Each domain/subdomain is treated as separate website
- ✅ If domain exists, ingestion automatically calls sync
- ✅ No error thrown - seamless transition

---

### **STEP 2: New Domain - Register Website**
✅ **IMPLEMENTED** (Only ingestion can do this)

**2a. Create Gemini File Search Store**
- **Location**: `src/services/ingestion.ts` (lines 131-135)
- Creates store with name: `website-{domain}-{timestamp}`
- Each domain/subdomain gets its own store

**2b. Create Website Record in Supabase**
- **Location**: `src/services/ingestion.ts` (lines 137-147)
- Stores:
  - `seed_url`: Normalized seed URL
  - `domain`: Exact domain (each domain/subdomain separate)
  - `display_name`: User-provided or domain
  - `gemini_store_id`: Store ID from step 2a
  - `gemini_store_name`: Store display name

**Key Points:**
- ✅ Store created BEFORE website record
- ✅ Store ID immediately stored in website record
- ✅ This is the ONLY place where new websites are registered
- ✅ Sync service cannot create websites (requires existing website)

---

## Flow Summary

```
Input: seedUrl (string)
  ↓
[STEP 0] Validate with Zod
  ├─ Invalid → Throw error
  └─ Valid → Continue
  ↓
[STEP 1] Check if domain exists
  ├─ Exists → Route to sync → Return sync result
  └─ New → Continue
  ↓
[STEP 2] Register new website
  ├─ 2a. Create Gemini store
  └─ 2b. Create website record with store ID
  ↓
[STEP 3-9] Continue with ingestion (map, scrape, write, index)
```

---

## ✅ Production-Grade Features

1. **Input Validation**: Zod schema validates URL/domain format
2. **Domain Existence Check**: Automatically routes to sync if domain exists
3. **Website Registration**: Only ingestion can register new websites
4. **Store Creation**: Store created during registration, ID stored immediately
5. **Error Handling**: Clear error messages for validation failures
6. **Logging**: Comprehensive logging at each step

---

## Verification Checklist

- ✅ Input validation with Zod
- ✅ Domain existence check
- ✅ Automatic routing to sync if domain exists
- ✅ Store creation during registration
- ✅ Website record creation with store ID
- ✅ Only ingestion can register new websites
- ✅ Sync requires existing website (cannot create)

---

## Code Locations

- **Validation**: `src/services/ingestion-validation.ts`
- **Main Logic**: `src/services/ingestion.ts`
- **Domain Check**: `src/services/ingestion.ts:97-125`
- **Registration**: `src/services/ingestion.ts:127-147`

