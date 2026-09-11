-- Catch-up migration for the already-created project: adds paid_months to
-- funds, backing the "Mark paid" override for Varying funds whose real bill
-- comes in under the schedule's modeled amount for a given month. db/schema.sql
-- now includes this directly for a fresh install. Run once in the Supabase
-- SQL editor.

alter table funds add column if not exists paid_months jsonb not null default '[]'::jsonb;
