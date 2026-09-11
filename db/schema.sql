-- Sinking Funds cloud-sync schema (Supabase Postgres).
-- See CLAUDE.md's "Google login + database" section for the full plan this
-- implements, and the DVCalc project (a sibling app) for the pattern this
-- follows: Supabase Postgres + Google OAuth + Row-Level Security, no custom
-- backend.
--
-- Run this in the Supabase SQL editor for a fresh project. Idempotent-ish
-- (IF NOT EXISTS / CREATE OR REPLACE), but not a real migration tool -- for
-- schema changes later, add a new dated file in this directory rather than
-- editing this one in place once it's live.
--
-- Ids: the app generates its own entry ids client-side (uid(), e.g.
-- "e8f3k2j1a9b7c6d5") -- these are kept as the primary key everywhere
-- (`text`, not `uuid`) rather than letting Postgres generate a separate id,
-- so there's no app-id<->db-id mapping layer, and shared ids (a transfer's
-- two legs via pair_id, a split's parts via split_id) keep working exactly
-- as they do locally. `user_id` is the one genuine uuid, straight from
-- Supabase auth.

-- ---------------------------------------------------------------------
-- profiles: one row per auth user, auto-created on signup.
-- ---------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles: select own" on profiles
  for select using (auth.uid() = id);
create policy "profiles: update own" on profiles
  for update using (auth.uid() = id);
-- No insert/delete policy for users -- profiles are created by the trigger
-- below (as the postgres role) and deleted via cascade from auth.users.

create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Shared updated_at trigger, reused on every table below that has the column.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- settings: one row per user, the handful of singleton meta fields.
-- lastBackup isn't here -- that's purely a local-file-mode concern.
-- ---------------------------------------------------------------------
create table if not exists settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  plan_start text,   -- 'YYYY-MM' or null -- meta.planStart
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;
create policy "settings: full access to own row" on settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists settings_set_updated_at on settings;
create trigger settings_set_updated_at
  before update on settings for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- categories
-- ---------------------------------------------------------------------
create table if not exists categories (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  icon text not null default '💡',
  color text not null,
  note text not null default '',
  -- Array position IS display order locally ("Array order is display order
  -- for both" -- CLAUDE.md's Data model section); SQL rows have no inherent
  -- order, so this is what stands in for it here.
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists categories_user_id_idx on categories(user_id);
create index if not exists categories_user_sort_idx on categories(user_id, sort_order);

alter table categories enable row level security;
create policy "categories: full access to own rows" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists categories_set_updated_at on categories;
create trigger categories_set_updated_at
  before update on categories for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- funds
-- ---------------------------------------------------------------------
create table if not exists funds (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  category_id text not null references categories(id) on delete cascade,
  name text not null,
  target numeric(12,2) not null default 0,
  target_date date,
  -- The 12-slot irregular-expense array (schedule.amounts). Only ever read
  -- or written as one atomic unit, never queried by individual month
  -- server-side -- same reasoning DVCalc used for itineraries.segments, so
  -- jsonb here rather than a child table. Null means "no schedule."
  schedule_amounts jsonb,
  buffer boolean not null default false,
  floor numeric(12,2) not null default 0,
  fixed boolean not null default false,
  due_day int not null default 0,
  ceiling numeric(12,2) not null default 0,
  note text not null default '',
  sort_order integer not null default 0,   -- same reasoning as categories.sort_order
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists funds_user_id_idx on funds(user_id);
create index if not exists funds_category_id_idx on funds(category_id);
create index if not exists funds_user_sort_idx on funds(user_id, sort_order);

alter table funds enable row level security;
create policy "funds: full access to own rows" on funds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists funds_set_updated_at on funds;
create trigger funds_set_updated_at
  before update on funds for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- fund_budgets: the dated fund.budgets[] series. One reading per
-- (fund, month) -- re-editing the same month corrects it rather than
-- stacking, same rule as the app enforces client-side, enforced here too so
-- an upsert on (fund_id, from_month) is always the right operation.
-- ---------------------------------------------------------------------
create table if not exists fund_budgets (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  fund_id text not null references funds(id) on delete cascade,
  from_month text not null,   -- 'YYYY-MM'
  amount numeric(12,2) not null default 0
);

create index if not exists fund_budgets_fund_id_idx on fund_budgets(fund_id);
create unique index if not exists fund_budgets_fund_month_idx on fund_budgets(fund_id, from_month);

alter table fund_budgets enable row level security;
create policy "fund_budgets: full access to own rows" on fund_budgets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- ledger: the big one. kind is null for an ordinary entry -- only
-- "allotment" and "transfer" are real tags, exactly like the client's
-- normalize(). pair_id links a transfer's two legs; split_id links a split
-- expense's parts. Neither is a foreign key to anything -- they're just a
-- shared value across sibling rows, same as locally.
-- ---------------------------------------------------------------------
create table if not exists ledger (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  fund_id text not null references funds(id) on delete cascade,
  amount numeric(12,2) not null,
  date date not null,
  note text not null default '',
  store text not null default '',
  kind text check (kind in ('allotment', 'transfer')),
  pair_id text,
  split_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ledger_user_id_idx on ledger(user_id);
create index if not exists ledger_fund_id_idx on ledger(user_id, fund_id);
create index if not exists ledger_date_idx on ledger(user_id, date);
create index if not exists ledger_pair_id_idx on ledger(pair_id) where pair_id is not null;
create index if not exists ledger_split_id_idx on ledger(split_id) where split_id is not null;

alter table ledger enable row level security;
create policy "ledger: full access to own rows" on ledger
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists ledger_set_updated_at on ledger;
create trigger ledger_set_updated_at
  before update on ledger for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- cash_readings / card_readings: identical dated-series shape. One reading
-- per (user, date), same "corrects rather than stacks" rule as fund_budgets.
-- ---------------------------------------------------------------------
create table if not exists cash_readings (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  amount numeric(12,2) not null default 0,
  note text not null default ''
);

create unique index if not exists cash_readings_user_date_idx on cash_readings(user_id, date);

alter table cash_readings enable row level security;
create policy "cash_readings: full access to own rows" on cash_readings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists card_readings (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  date date not null,
  amount numeric(12,2) not null default 0,
  note text not null default ''
);

create unique index if not exists card_readings_user_date_idx on card_readings(user_id, date);

alter table card_readings enable row level security;
create policy "card_readings: full access to own rows" on card_readings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- plans: earmarks. Several per fund is normal (e.g. two earmarks against
-- one Travel fund), so no uniqueness constraint here.
-- ---------------------------------------------------------------------
create table if not exists plans (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  fund_id text not null references funds(id) on delete cascade,
  name text not null default 'Earmark',
  amount numeric(12,2) not null default 0,
  month text not null default '',   -- 'YYYY-MM', optional
  note text not null default '',
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

create index if not exists plans_fund_id_idx on plans(fund_id);

alter table plans enable row level security;
create policy "plans: full access to own rows" on plans
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- incomes: dated income series (meta.incomes). One per (user, month).
-- ---------------------------------------------------------------------
create table if not exists incomes (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  from_month text not null,   -- 'YYYY-MM'
  amount numeric(12,2) not null default 0
);

create unique index if not exists incomes_user_month_idx on incomes(user_id, from_month);

alter table incomes enable row level security;
create policy "incomes: full access to own rows" on incomes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- one_offs: forecast pencil-ins (meta.oneOffs). Several per month is normal
-- (a paycheck and a bill landing the same month), so no uniqueness
-- constraint here either.
-- ---------------------------------------------------------------------
create table if not exists one_offs (
  id text primary key,
  user_id uuid not null references profiles(id) on delete cascade,
  month text not null,   -- 'YYYY-MM'
  amount numeric(12,2) not null,
  note text not null default ''
);

create index if not exists one_offs_user_id_idx on one_offs(user_id);

alter table one_offs enable row level security;
create policy "one_offs: full access to own rows" on one_offs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
