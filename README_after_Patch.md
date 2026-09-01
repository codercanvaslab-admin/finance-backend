# Code Patch Files — Read Before Applying

These are drop-in replacements/additions for your `finance-automation` project,
addressing three things discussed in chat:

1. Image/scanned-invoice support (Gemini vision fallback)
2. Independent, deterministic GST tax-type validation
3. Duplicate-invoice guard + full tracked schema

## Files and where they go (relative to your finance-automation/ folder)

- `src/services/geminiService.js` → REPLACES your existing file (still Groq-based
  text extraction, just refactored into reusable pieces)
- `src/services/visionService.js` → NEW file (Gemini vision for images/scans)
- `src/services/extractionService.js` → NEW file (the orchestrator — routes
  each invoice to the right path automatically)
- `src/services/taxValidation.js` → NEW file (deterministic GSTIN state-code
  cross-check + math balance check)
- `src/routes/invoices.js` → REPLACES your existing file (wired to use the
  new orchestrator + validation)
- `supabase/migrations/2002605300002_extend_invoices_table.sql` → run this
- `supabase/migrations/2002605300003_vendors_tds_schema.sql` → run this
- `supabase/migrations/2002605300004_duplicate_invoice_guard.sql` → run this

## New dependencies to install

```bash
npm install pdf-to-png-converter
```
(`@google/generative-ai` is already in your package.json — it just wasn't being used before.)

## New environment variable needed

Add to your `.env`:
```
GEMINI_API_KEY=<your Gemini API key, from Google AI Studio>
```

## Order of operations to apply this safely

1. Back up your current `finance-automation` folder (or just make sure it's committed to git).
2. Run the 3 SQL migrations against your Supabase project, in the numbered order.
3. Install `pdf-to-png-converter`.
4. Add `GEMINI_API_KEY` to your `.env`.
5. Copy in the 5 code files above (2 replace existing files, 3 are new).
6. Test with: (a) a clean digital PDF, (b) a photo of a printed invoice (JPG),
   (c) a scanned PDF with no text layer — confirm all three now work and show
   up correctly in the Review screen, including any validation flags.
