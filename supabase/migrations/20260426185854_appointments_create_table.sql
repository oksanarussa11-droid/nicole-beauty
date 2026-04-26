-- Nicole Beauty — Migration: appointments (Session 4 MVP)
-- Idempotent: safe to re-run as part of `supabase db reset`.

create table if not exists appointments (
  id                bigserial primary key,
  scheduled_at      timestamptz not null,
  duration_minutes  integer,
  master_id         bigint not null references masters(id) on delete restrict,
  service_id        bigint references services(id) on delete set null,
  service_name      text,
  estimated_price   numeric(12,2),
  client_name       text,
  client_phone      text,
  status            text not null default 'scheduled'
                    check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  attendance_id     bigint references attendances(id) on delete set null,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        text
);

create index if not exists appointments_scheduled_idx on appointments(scheduled_at);
create index if not exists appointments_master_idx   on appointments(master_id);
create index if not exists appointments_status_idx   on appointments(status);

-- Conflict guard: same master cannot have two ACTIVE bookings at the exact same instant.
-- Cancelled/completed/no_show rows are excluded so a slot can be reused after cancel.
create unique index if not exists appointments_master_slot_uniq
  on appointments(master_id, scheduled_at)
  where status in ('scheduled','confirmed');

alter table appointments enable row level security;

drop policy if exists "anon_select_appointments" on appointments;
create policy "anon_select_appointments" on appointments
  for select to anon using (true);

drop policy if exists "authed_select_appointments" on appointments;
create policy "authed_select_appointments" on appointments
  for select to authenticated using (true);

grant all on table appointments to anon, authenticated, service_role;
grant all on sequence appointments_id_seq to anon, authenticated, service_role;

-- ─── Atomic completion: appointment → attendance ───────────────────────
-- Wraps the price/commission lookup, attendance INSERT, and appointment UPDATE
-- in a single transaction. Server-side authorization (admin_password / PIN)
-- happens in api/appointment.js before this is called.
create or replace function complete_appointment(
  p_appt_id             bigint,
  p_final_price         numeric,
  p_payment_method      text,
  p_uses_salon_products boolean
) returns bigint
language plpgsql
security definer
as $$
declare
  v_appt           appointments%rowtype;
  v_ms             master_services%rowtype;
  v_commission_pct numeric(5,2);
  v_master_pay     numeric(12,2);
  v_service_name   text;
  v_attendance_id  bigint;
begin
  select * into v_appt from appointments where id = p_appt_id for update;
  if not found then
    raise exception 'appointment % not found', p_appt_id;
  end if;
  if v_appt.status not in ('scheduled','confirmed') then
    raise exception 'appointment % is %, cannot complete', p_appt_id, v_appt.status;
  end if;
  if not (p_final_price > 0) then
    raise exception 'final_price must be positive';
  end if;

  select * into v_ms
    from master_services
    where master_id = v_appt.master_id and service_id = v_appt.service_id
    limit 1;
  if not found then
    raise exception 'service not configured for this master';
  end if;

  v_commission_pct := case
    when coalesce(p_uses_salon_products, false) then v_ms.commission_master_pct_salon
    else v_ms.commission_master_pct
  end;
  v_master_pay := round(p_final_price * v_commission_pct / 100, 2);

  select name into v_service_name from services where id = v_appt.service_id;

  insert into attendances (
    date, time, master_id, service_id, service_name,
    price, master_pay, commission_pct,
    uses_salon_products, client_name, payment_method, source, note
  ) values (
    (v_appt.scheduled_at at time zone 'Europe/Samara')::date,
    (v_appt.scheduled_at at time zone 'Europe/Samara')::time,
    v_appt.master_id, v_appt.service_id,
    coalesce(v_appt.service_name, v_service_name),
    p_final_price, v_master_pay, v_commission_pct,
    coalesce(p_uses_salon_products, false),
    v_appt.client_name, p_payment_method, 'appointment', v_appt.note
  ) returning id into v_attendance_id;

  update appointments
     set status = 'completed', attendance_id = v_attendance_id
     where id = p_appt_id;

  return v_attendance_id;
end;
$$;

grant execute on function complete_appointment(bigint, numeric, text, boolean) to anon, authenticated, service_role;
