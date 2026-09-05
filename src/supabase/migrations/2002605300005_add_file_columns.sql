-- supabase/migrations/2002605300005_add_file_columns.sql
-- ─────────────────────────────────────────────────────────────
-- Adds file_url / file_type to invoices.
--
-- Root cause of "Review screen always shows No file preview" and
-- "Re-run AI button not clickable": the frontend (review.tsx) has
-- referenced invoice.file_url / invoice.file_type since it was
-- written, but no migration ever created these columns and the
-- backend never wrote them — the exact "code deployed ahead of its
-- own schema migration" trap called out in CLAUDE.md §8.7 for
-- suggested_tds_reasoning. Same lesson applies here: run this against
-- the live Supabase project — writing this file is not enough.
-- ─────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS file_url text,
  ADD COLUMN IF NOT EXISTS file_type text;
