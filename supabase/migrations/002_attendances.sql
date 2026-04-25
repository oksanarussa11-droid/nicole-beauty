-- Nicole Beauty — Migration 002: Professional self-service attendance entry
-- Run this once in Supabase → SQL Editor → New query → paste → RUN.
-- Safe to re-run: uses IF NOT EXISTS / CREATE OR REPLACE where possible.

-- ============ PIN column on masters ============
alter table masters add column if not exists pin_hash text;

-- ============ Granular per-service attendance records ============
create table if not exists attendances (
  id              bigserial primary key,
  date            date   not null default current_date,
  time            time,
  master_id       bigint not null references masters(id) on delete restrict,
  service_id      bigint references services(id) on delete set null,
  service_name    text,                             -- snapshot in case service renamed/deleted
  price           numeric(12,2) not null,
  master_pay      numeric(12,2) not null default 0, -- computed server-side at insert
  commission_pct  numeric(5,2),                     -- snapshot
  client_name     text,
  payment_method  text,
  source          text   not null default 'pro_form',  -- 'pro_form' | 'ocr' | 'admin'
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists attendances_date_idx   on attendances(date);
create index if not exists attendances_master_idx on attendances(master_id);

-- ============ PIN attempts (audit + rate limit source) ============
create table if not exists pin_attempts (
  id           bigserial primary key,
  master_id    bigint references masters(id) on delete set null,
  ip           text,
  success      boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_master_ts_idx on pin_attempts(master_id, attempted_at desc);

-- ============ RLS ============
alter table attendances  enable row level security;
alter table pin_attempts enable row level security;

-- anon may SELECT attendances (admin dashboard + pro's own-today view) but NOT write.
-- Writes happen only via /api/attendance using the service-role key (bypasses RLS).
drop policy if exists "anon_select_attendances" on attendances;
create policy "anon_select_attendances" on attendances for select to anon using (true);

drop policy if exists "authed_select_attendances" on attendances;
create policy "authed_select_attendances" on attendances for select to authenticated using (true);

-- pin_attempts: no anon policies → default deny. Only service-role (server) touches this table.

-- ============ Public view of masters (hides pin_hash) ============
-- IMPORTANT: this replaces direct SELECTs on `masters` from the browser.
-- Both index.html and register.html must query `masters_public` for the dropdown,
-- so pin_hash never leaves the database.
create or replace view masters_public as
  select id, name, specialty, active, created_at from masters;

grant select on masters_public to anon, authenticated;

-- Optional tightening: revoke anon access to the raw masters table if your app
-- doesn't need direct anon SELECT on it. (The admin UI currently uses anon for
-- CRUD; it reads masters for editing, so keep it open for now.)
-- revoke select on masters from anon;
