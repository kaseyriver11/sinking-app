-- Catch-up migration for the already-created project: adds the "store"
-- field to ledger entries (e.g. "Target"), which db/schema.sql now includes
-- directly for a fresh install. Run once in the Supabase SQL editor.

alter table ledger add column if not exists store text not null default '';
