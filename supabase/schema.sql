-- Nicole Beauty — Supabase schema
-- Run this in Supabase → SQL Editor → New Query → paste → RUN
-- Safe to re-run: uses IF NOT EXISTS / ON CONFLICT where possible.

-- ============ TABLES ============

create table if not exists masters (
  id          bigserial primary key,
  name        text not null unique,
  specialty   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists services (
  id          bigserial primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- Price + commission per master+service combination.
-- commission_master_pct = share (0–100) that goes to the master.
create table if not exists master_services (
  id                    bigserial primary key,
  master_id             bigint not null references masters(id) on delete cascade,
  service_id            bigint not null references services(id) on delete cascade,
  price                 numeric(12,2) not null default 0,
  commission_master_pct numeric(5,2)  not null default 50,
  created_at            timestamptz not null default now(),
  unique (master_id, service_id)
);

-- Daily aggregated revenue per master (matches the current panel UX).
create table if not exists day_summaries (
  id          bigserial primary key,
  date        date   not null,
  master_id   bigint not null references masters(id) on delete restrict,
  revenue     numeric(12,2) not null default 0,
  master_pay  numeric(12,2) not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists day_summaries_date_idx   on day_summaries(date);
create index if not exists day_summaries_master_idx on day_summaries(master_id);

create table if not exists income (
  id           bigserial primary key,
  date         date   not null,
  category     text   not null,
  description  text,
  amount       numeric(12,2) not null default 0,
  method       text,
  created_at   timestamptz not null default now()
);
create index if not exists income_date_idx on income(date);

create table if not exists expenses (
  id           bigserial primary key,
  date         date   not null,
  category     text   not null,
  description  text,
  amount       numeric(12,2) not null default 0,
  supplier     text,
  status       text   not null default 'Не оплачено',
  created_at   timestamptz not null default now()
);
create index if not exists expenses_date_idx on expenses(date);

create table if not exists inventory (
  id           bigserial primary key,
  brand        text   not null,
  name         text   not null,
  created_at   timestamptz not null default now(),
  unique (brand, name)
);

-- PIN per master (bcrypt/scrypt-hashed, server-validated via /api/attendance + /api/verify-pin).
-- Nullable until set by admin. Never expose to anon — use the masters_public view below.
alter table masters add column if not exists pin_hash text;

-- Granular per-service attendance records, fed by /api/attendance (pro form).
create table if not exists attendances (
  id              bigserial primary key,
  date            date   not null default current_date,
  time            time,
  master_id       bigint not null references masters(id) on delete restrict,
  service_id      bigint references services(id) on delete set null,
  service_name    text,
  price           numeric(12,2) not null,
  master_pay      numeric(12,2) not null default 0,
  commission_pct  numeric(5,2),
  client_name     text,
  payment_method  text,
  source          text   not null default 'pro_form',
  note            text,
  created_at      timestamptz not null default now()
);
create index if not exists attendances_date_idx   on attendances(date);
create index if not exists attendances_master_idx on attendances(master_id);

-- Audit + rate-limit source for PIN validation.
create table if not exists pin_attempts (
  id           bigserial primary key,
  master_id    bigint references masters(id) on delete set null,
  ip           text,
  success      boolean not null,
  attempted_at timestamptz not null default now()
);
create index if not exists pin_attempts_master_ts_idx on pin_attempts(master_id, attempted_at desc);

-- Public view of masters — excludes pin_hash so it never reaches the browser.
create or replace view masters_public as
  select id, name, specialty, active, created_at from masters;
grant select on masters_public to anon, authenticated;

-- ============ ROW LEVEL SECURITY ============
-- Open policies for the anon role (internal use, small salon).
-- Tighten later by enabling Supabase Auth and switching to user-scoped policies.

alter table masters         enable row level security;
alter table services        enable row level security;
alter table master_services enable row level security;
alter table day_summaries   enable row level security;
alter table income          enable row level security;
alter table expenses        enable row level security;
alter table inventory       enable row level security;
alter table attendances     enable row level security;
alter table pin_attempts    enable row level security;

-- attendances: anon can SELECT (dashboards), but WRITES only via service-role (/api/attendance).
drop policy if exists "anon_select_attendances"   on attendances;
create policy "anon_select_attendances" on attendances for select to anon using (true);
drop policy if exists "authed_select_attendances" on attendances;
create policy "authed_select_attendances" on attendances for select to authenticated using (true);

-- pin_attempts: no anon policies → default deny. Only service-role touches it.

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'masters','services','master_services','day_summaries','income','expenses','inventory'
  ]) loop
    execute format('drop policy if exists "anon_all_%1$s" on %1$I;', t);
    execute format('create policy "anon_all_%1$s" on %1$I for all to anon using (true) with check (true);', t);
    execute format('drop policy if exists "authed_all_%1$s" on %1$I;', t);
    execute format('create policy "authed_all_%1$s" on %1$I for all to authenticated using (true) with check (true);', t);
  end loop;
end$$;

-- ============ SEED DATA ============

insert into masters (name, specialty) values
  ('Людмила', 'Волосы'),
  ('Ирина',   'Волосы')
on conflict (name) do nothing;

insert into services (name) values
  ('Стрижка'),
  ('Окрашивание'),
  ('Укладка'),
  ('Уход')
on conflict (name) do nothing;

-- Default commission rules matching the original panel:
--   Стрижка 50/50, Окрашивание 40/60 (40% to master).
insert into master_services (master_id, service_id, price, commission_master_pct)
select m.id, s.id, 0,
  case s.name
    when 'Стрижка'     then 50
    when 'Окрашивание' then 40
    else 50
  end
from masters m cross join services s
on conflict (master_id, service_id) do nothing;

insert into inventory (brand, name) values
  ('Constant Delight', 'Краска для волос'),
  ('Constant Delight', 'Оксид 6%'),
  ('Constant Delight', 'Шампунь'),
  ('Constant Delight', 'Бальзам'),
  ('Constant Delight', 'Маска для волос'),
  ('Matrix', 'Краска SoColor'),
  ('Matrix', 'Оксид 6%'),
  ('Matrix', 'Шампунь Total Results'),
  ('Matrix', 'Бальзам Total Results'),
  ('Matrix', 'Маска Total Results')
on conflict (brand, name) do nothing;
