-- supabase/migrations/2002605300003_seed_tds_sections.sql
-- ─────────────────────────────────────────────────────────────
-- Your TDS dropdown IS already server-driven (backend reads from
-- this table, frontend fetches from the backend) — the code is
-- correct. The likely actual problem: this table was never seeded
-- with real data, so the dropdown has nothing (or almost nothing)
-- to show.
--
-- This seeds the most common vendor-invoice-relevant TDS sections.
-- Rates below are the standard resident rates as of FY 2026-27 —
-- VERIFY against the current official rate chart before relying on
-- this in production; TDS rates can change with each Union Budget
-- (see the TDS Calculation Explained doc, §3, for the yearly-review
-- process). Uses ON CONFLICT so it's safe to re-run.
-- ─────────────────────────────────────────────────────────────

INSERT INTO public.tds_sections
  (section, sub_type, nature_of_payment, threshold_single, threshold_aggregate, rate_individual, rate_company, rate_no_pan, is_active)
VALUES
  ('194J', 'Professional Fees', 'Fees for professional or technical services', 0, 30000, 10, 10, 20, true),
  ('194J', 'Technical Fees', 'Fees for technical services (lower-rate sub-category)', 0, 30000, 2, 2, 20, true),
  ('194C', 'Contractor - Individual/HUF', 'Payment to resident contractors (individual/HUF)', 30000, 100000, 1, 1, 20, true),
  ('194C', 'Contractor - Others', 'Payment to resident contractors (firm/company)', 30000, 100000, 2, 2, 20, true),
  ('194H', 'Commission/Brokerage', 'Commission or brokerage payments', 0, 15000, 5, 5, 20, true),
  ('194I', 'Rent - Plant/Machinery', 'Rent on plant, machinery, or equipment', 0, 240000, 2, 2, 20, true),
  ('194I', 'Rent - Land/Building', 'Rent on land, building, or furniture', 0, 240000, 10, 10, 20, true),
  ('194Q', 'Purchase of Goods', 'TDS on purchase of goods (buyer turnover > ₹10 Cr) — see known gap in TDS doc re: TCS overlap', 5000000, 5000000, 0.1, 0.1, 5, true),
  ('194A', 'Interest (Other than Securities)', 'Interest payments other than on securities', 0, 40000, 10, 10, 20, true),
  ('194', 'Dividend', 'Dividend distribution to resident shareholders', 5000, 5000, 10, 10, 20, true)
ON CONFLICT DO NOTHING;

-- Sanity check after running — confirm the table actually has rows:
-- SELECT section, sub_type, nature_of_payment, rate_individual, rate_company FROM public.tds_sections ORDER BY section;
