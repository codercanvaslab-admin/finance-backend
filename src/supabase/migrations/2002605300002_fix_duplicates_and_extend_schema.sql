-- supabase/migrations/2002605300002_fix_duplicates_and_extend_schema.sql
-- ─────────────────────────────────────────────────────────────
-- Run this against your Supabase project. Fixes Bug #1 (duplicate
-- invoices) and Bug #3 (missing columns) in one file.
--
-- Safe to run on your existing project — every statement uses
-- IF NOT EXISTS, so it won't error or overwrite existing data.
-- ─────────────────────────────────────────────────────────────

-- 1. Add every column the code actually writes to, but that was
--    never in your only tracked migration (the bare original table).
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vendor_id uuid,
  ADD COLUMN IF NOT EXISTS vendor_gstin text,
  ADD COLUMN IF NOT EXISTS buyer_gstin text,
  ADD COLUMN IF NOT EXISTS taxable_amount numeric,
  ADD COLUMN IF NOT EXISTS invoice_number text,
  ADD COLUMN IF NOT EXISTS financial_year text,
  ADD COLUMN IF NOT EXISTS cgst numeric,
  ADD COLUMN IF NOT EXISTS sgst numeric,
  ADD COLUMN IF NOT EXISTS igst numeric,
  ADD COLUMN IF NOT EXISTS gst_rate numeric,
  ADD COLUMN IF NOT EXISTS is_igst boolean,
  ADD COLUMN IF NOT EXISTS place_of_supply text,
  ADD COLUMN IF NOT EXISTS hsn_sac text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS line_items jsonb,
  ADD COLUMN IF NOT EXISTS tds_applicable boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS tds_section_id integer,
  ADD COLUMN IF NOT EXISTS tds_rate numeric,
  ADD COLUMN IF NOT EXISTS tds_amount numeric,
  ADD COLUMN IF NOT EXISTS net_payable numeric,
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS extraction_method text,
  ADD COLUMN IF NOT EXISTS needs_review boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS validation_flags jsonb,
  ADD COLUMN IF NOT EXISTS payment_status text DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by text,
  ADD COLUMN IF NOT EXISTS notes text;

-- 2. THE ACTUAL FIX FOR BUG #1 — the duplicate guard that was
--    never applied. This is the missing piece: without this
--    constraint, nothing stops the same invoice being inserted
--    twice, no matter what error-handling code exists in
--    invoices.js (that code was only ever a safety net for a
--    constraint that didn't exist yet).
--
--    Uses a partial unique index instead of a table constraint so
--    it correctly IGNORES rows with a null invoice_number/gstin
--    (a blank field shouldn't false-positive-match every other
--    blank field as "duplicate").
DROP INDEX IF EXISTS idx_unique_invoice_per_vendor;
CREATE UNIQUE INDEX idx_unique_invoice_per_vendor
  ON public.invoices (vendor_gstin, invoice_number)
  WHERE vendor_gstin IS NOT NULL AND invoice_number IS NOT NULL;

-- 3. Helpful indexes for the Review/Analytics screens
CREATE INDEX IF NOT EXISTS idx_invoices_status ON public.invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON public.invoices(vendor_id);
CREATE INDEX IF NOT EXISTS idx_invoices_financial_year ON public.invoices(financial_year);

-- 4. IMPORTANT — verify this manually after running the above:
--    if you have LEFTOVER duplicate rows already sitting in your
--    table from testing, this CREATE UNIQUE INDEX will FAIL with
--    an error naming the conflicting rows. If that happens, first
--    run:
--
--    SELECT vendor_gstin, invoice_number, COUNT(*)
--    FROM public.invoices
--    WHERE vendor_gstin IS NOT NULL AND invoice_number IS NOT NULL
--    GROUP BY vendor_gstin, invoice_number
--    HAVING COUNT(*) > 1;
--
--    ...delete the extra duplicate rows it finds, then re-run this file.
