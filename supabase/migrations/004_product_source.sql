-- Migration 004 — differentiated commission by product source
--
-- Why: masters earn different commission rates depending on whether they used
-- their own products (higher %) or salon-provided products (lower %).
-- Both rates are configured per (master, service) pair by the admin.
--
-- Changes:
--   master_services.commission_master_pct       — already exists, treated as
--                                                 the rate when master uses
--                                                 OWN products (the default
--                                                 / generous rate)
--   master_services.commission_master_pct_salon — NEW, rate when master uses
--                                                 SALON-provided products
--                                                 (typically lower)
--   attendances.uses_salon_products             — NEW, audit flag stored with
--                                                 each attendance row so we
--                                                 can later report by source
--
-- Run in Supabase → SQL Editor → New query → paste → RUN. Safe to re-run.

-- ---------- master_services: salon-products commission rate ----------
alter table master_services
  add column if not exists commission_master_pct_salon numeric(5,2) not null default 40;

comment on column master_services.commission_master_pct       is 'Master share (0–100) when master uses OWN products. Higher of the two rates.';
comment on column master_services.commission_master_pct_salon is 'Master share (0–100) when master uses SALON-provided products. Lower of the two rates.';

-- ---------- attendances: which rule was applied ----------
alter table attendances
  add column if not exists uses_salon_products boolean not null default false;

comment on column attendances.uses_salon_products is 'true = salon-provided products were used (lower commission rate); false = master used own products (higher rate).';

-- ---------- backfill existing master_services ----------
-- For pairs where commission_master_pct_salon is still at the default (40),
-- but the existing commission_master_pct is lower (e.g. 30), bump the salon
-- rate down so it stays ≤ the own-products rate. Admin should review.
update master_services
   set commission_master_pct_salon = greatest(0, least(commission_master_pct - 10, commission_master_pct))
 where commission_master_pct_salon = 40
   and commission_master_pct < 40;

-- The trigger from migration 003 (auto-fill master_services) already uses
-- default 50 for commission_master_pct; the new column gets default 40 from
-- the column declaration itself — no trigger change needed.
