# Gemini Operation Polling Error Fix

## Issue Identified

**Error:** `Cannot read properties of undefined (reading 'name')`

**Location:** `src/clients/gemini.ts` - `waitForOperation()` function when calling `genai.operations.get()`

**Context:** 
- Ingestion pipeline completed successfully ✅
- 52 pages written to DB with status='processing' ✅
- Indexing pipeline triggered ✅
- Error occurs during Gemini upload (indexing pipeline)

## Root Cause

The Gemini SDK's `genai.operations.get()` method is throwing an error internally when trying to access a property. This could be:
1. SDK version incompatibility
2. Operation name format issue
3. SDK internal error handling

## Fixes Applied

1. **Added validation** before calling `genai.operations.get()`
2. **Added error handling** for undefined errors
3. **Added fallback** - if operation has response, assume complete
4. **Better logging** to debug the actual error

## Current Status

- ✅ Ingestion pipeline: **WORKING** (52 pages written)
- ⚠️ Indexing pipeline: **HAS ERROR** (Gemini upload polling issue)

## Next Steps

The ingestion test should verify:
- ✅ Pages written with status='processing'
- ✅ All pages have complete data
- ✅ Ingestion job completed

The indexing error is a separate issue that doesn't affect ingestion pipeline testing.

