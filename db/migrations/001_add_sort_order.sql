-- Catch-up migration for the already-created project: db/schema.sql's first
-- pass missed that array position IS display order for categories and funds
-- ("Array order is display order for both" -- CLAUDE.md's Data model
-- section) -- there was no column for it. Run this once in the Supabase SQL
-- editor against the live database; a fresh install gets it for free once
-- schema.sql itself is updated to include these columns directly.

alter table categories add column if not exists sort_order integer not null default 0;
alter table funds add column if not exists sort_order integer not null default 0;

create index if not exists categories_user_sort_idx on categories(user_id, sort_order);
create index if not exists funds_user_sort_idx on funds(user_id, sort_order);
