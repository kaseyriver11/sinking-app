-- Catch-up migration for the already-created project: adds "auto" to funds,
-- backing the Auto-pay tag on Fixed/Varying bills (purely informational --
-- charged automatically, no manual payment needed). db/schema.sql now
-- includes this directly for a fresh install. Run once in the Supabase
-- SQL editor.

alter table funds add column if not exists auto boolean not null default false;
