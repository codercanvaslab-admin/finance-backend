-- supabase/migrations/2002605300004_add_tds_suggestion_columns.sql
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS suggested_tds_section_id integer,
  ADD COLUMN IF NOT EXISTS suggested_tds_reasoning text;
