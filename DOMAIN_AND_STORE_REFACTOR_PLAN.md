# Domain and Store Refactor Plan

## Requirements

1. **Domain/Subdomain Logic:**
   - Same base domain (e.g., `example.com`, `www.example.com`) = Same website ID
   - Different subdomains (e.g., `subdomain.example.com` vs `example.com`) = Different websites
   - Need base domain extraction function

2. **Ingestion Only Creates Website:**
   - Only ingestion service can register new website
   - Sync requires existing website with at least one page

3. **Domain Resolution Check:**
   - If user passes `https://www.example.com/path`, extract base domain `example.com`
   - Check if website with base domain exists
   - If exists → return existing website ID (suggest sync)
   - If not → proceed with ingestion

4. **File Store Creation:**
   - Create during website registration (in ingestion)
   - One store per website ID
   - Store ID stored in website record

5. **Schema Updates:**
   - Ensure `gemini_store_id` is set during website creation
   - Verify constraints

## Implementation Steps

1. Add `extractBaseDomain()` function to `src/utils/url.ts`
2. Update `getWebsiteByDomain()` to check by base domain
3. Update ingestion to:
   - Extract base domain from seed URL
   - Check if website exists by base domain
   - Create store during website registration
   - Ensure store ID is set
4. Update sync to verify website has pages
5. Add domain resolution helper function

