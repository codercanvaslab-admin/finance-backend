-- 2002605300012_diagnose_and_backfill_vendor_org_id.sql
-- ─────────────────────────────────────────────────────────────
-- Fixes: Vendors screen shows blank.
--
-- Root cause (see CLAUDE.md §8k): vendors created before the
-- multi-tenancy org_id fix landed have org_id = NULL. Every
-- current vendor query — GET /api/vendors (via the
-- vendor_payment_summary view) and GET /api/vendors/:id — filters
-- .eq("org_id", req.orgId), which correctly excludes NULL rows.
-- So instead of erroring, the list just comes back empty.
--
-- The migration referenced in CLAUDE.md that was supposed to fix
-- this (2002605300009_backfill_vendor_org_id.sql) is not present
-- in this repo upload, so it's unclear whether it was ever applied
-- against live Supabase. Run the SELECTs below FIRST to see what
-- you're actually dealing with before running anything else.
-- ─────────────────────────────────────────────────────────────

-- STEP 1 — how many vendors are actually orphaned?
-- Run this first. If this returns 0 rows, the blank-vendors bug
-- has a different cause — stop here and check the API response
-- directly (browser dev tools → Network tab → /api/vendors) instead.
SELECT id, company_name, gstin, org_id, created_at
FROM public.vendors
WHERE org_id IS NULL
ORDER BY created_at;

-- STEP 2 — does the vendor_payment_summary view even expose org_id?
-- If this errors ("column org_id does not exist"), that's a
-- different, more urgent bug: GET /api/vendors would be failing
-- with a 500, not returning an empty list — check the view
-- definition and add org_id to its SELECT list if missing.
SELECT column_name FROM information_schema.columns
WHERE table_name = 'vendor_payment_summary' AND column_name = 'org_id';

-- STEP 3a — safe case: a NULL-org_id vendor is referenced by
-- invoices from exactly ONE org. Backfill it to that org.
-- (Preview first — this is a SELECT, not an UPDATE.)
SELECT v.id AS vendor_id, v.company_name,
       array_agg(DISTINCT i.org_id) AS distinct_invoice_org_ids
FROM public.vendors v
JOIN public.invoices i ON i.vendor_id = v.id
WHERE v.org_id IS NULL
GROUP BY v.id, v.company_name
HAVING COUNT(DISTINCT i.org_id) = 1;

-- Run the actual backfill for the safe (single-org) case:
UPDATE public.vendors v
SET org_id = sub.only_org_id
FROM (
  SELECT i.vendor_id, MIN(i.org_id) AS only_org_id
  FROM public.invoices i
  WHERE i.vendor_id IN (SELECT id FROM public.vendors WHERE org_id IS NULL)
  GROUP BY i.vendor_id
  HAVING COUNT(DISTINCT i.org_id) = 1
) sub
WHERE v.id = sub.vendor_id AND v.org_id IS NULL;

-- STEP 3b — corrupted case: a NULL-org_id vendor is referenced by
-- invoices from MULTIPLE orgs (two unrelated firms got matched to
-- the same vendor row while the bug was live). This needs manual
-- review/splitting — do NOT auto-backfill these; the query below
-- just surfaces them so you can decide case by case.
SELECT v.id AS vendor_id, v.company_name,
       array_agg(DISTINCT i.org_id) AS conflicting_org_ids,
       COUNT(*) AS invoice_count
FROM public.vendors v
JOIN public.invoices i ON i.vendor_id = v.id
WHERE v.org_id IS NULL
GROUP BY v.id, v.company_name
HAVING COUNT(DISTINCT i.org_id) > 1;

-- STEP 3c — orphaned vendors with no invoices at all (harmless —
-- safe to leave, or delete if you want a clean vendor list).
SELECT v.id, v.company_name, v.created_at
FROM public.vendors v
LEFT JOIN public.invoices i ON i.vendor_id = v.id
WHERE v.org_id IS NULL AND i.id IS NULL;

-- After 3a's UPDATE runs, re-run STEP 1 — it should now only
-- return rows from 3b (needs manual decision) and 3c (harmless).
