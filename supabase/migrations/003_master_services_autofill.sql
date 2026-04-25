-- Migration 003 — keep master_services aligned with masters × services
--
-- Why: when admin adds a new service via UI, only `services` gets a row.
-- The pro form (register.html) reads from `master_services` filtered by master_id,
-- so a service without master_services rows is invisible to all masters.
-- This migration installs triggers that auto-populate the cross-product whenever
-- a new master or service is inserted, plus a one-time backfill for any rows
-- currently missing.
--
-- Default for new rows: price=0, commission_master_pct=50.
-- Admin still needs to set the actual price in "Цены и комиссии" — but the row
-- now exists from the moment the service is created, so the master sees it
-- (with price 0 until configured).
--
-- Run in Supabase → SQL Editor → New query → paste → RUN. Safe to re-run.

-- ---------- one-time backfill: align current data ----------
insert into master_services (master_id, service_id, price, commission_master_pct)
select m.id, s.id, 0, 50
from masters m cross join services s
on conflict (master_id, service_id) do nothing;

-- ---------- trigger: when a new service is inserted, fill rows for all masters ----------
create or replace function ms_fill_for_new_service() returns trigger
language plpgsql as $$
begin
  insert into master_services (master_id, service_id, price, commission_master_pct)
  select m.id, NEW.id, 0, 50
  from masters m
  on conflict (master_id, service_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_ms_fill_for_new_service on services;
create trigger trg_ms_fill_for_new_service
  after insert on services
  for each row execute function ms_fill_for_new_service();

-- ---------- trigger: when a new master is inserted, fill rows for all services ----------
create or replace function ms_fill_for_new_master() returns trigger
language plpgsql as $$
begin
  insert into master_services (master_id, service_id, price, commission_master_pct)
  select NEW.id, s.id, 0, 50
  from services s
  on conflict (master_id, service_id) do nothing;
  return NEW;
end;
$$;

drop trigger if exists trg_ms_fill_for_new_master on masters;
create trigger trg_ms_fill_for_new_master
  after insert on masters
  for each row execute function ms_fill_for_new_master();
