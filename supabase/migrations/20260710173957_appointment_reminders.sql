-- Nicole Beauty — reminders 3 hours before appointments.
--
-- Telegram contacts are only considered verified after the user starts the bot
-- and shares their own phone number.  Delivery tables are server-only: the
-- service-role APIs expose the minimum data needed by the admin panel.

alter table appointments
  add column if not exists client_phone_e164 text;

-- Backfill the common Russian formats already stored by the application.
-- Other countries remain untouched and can be normalized on the next edit.
update appointments
set client_phone_e164 = case
  when regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g') ~ '^8[0-9]{10}$'
    then '+7' || substring(regexp_replace(client_phone, '[^0-9]', '', 'g') from 2)
  when regexp_replace(coalesce(client_phone, ''), '[^0-9]', '', 'g') ~ '^7[0-9]{10}$'
    then '+' || regexp_replace(client_phone, '[^0-9]', '', 'g')
  when client_phone ~ '^\+[1-9][0-9]{7,14}$'
    then client_phone
  else client_phone_e164
end
where client_phone_e164 is null;

create index if not exists appointments_client_phone_e164_idx
  on appointments(client_phone_e164);

create table if not exists notification_contacts (
  id                       bigserial primary key,
  phone_e164               text not null unique
                           check (phone_e164 ~ '^\+[1-9][0-9]{7,14}$'),
  telegram_user_id         bigint not null unique,
  telegram_chat_id         bigint not null unique,
  telegram_username        text,
  telegram_first_name      text,
  telegram_verified_at     timestamptz not null default now(),
  telegram_blocked_at      timestamptz,
  last_seen_at             timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists notification_contacts_phone_active_idx
  on notification_contacts(phone_e164)
  where telegram_blocked_at is null;

create table if not exists notification_deliveries (
  id                       bigserial primary key,
  appointment_id           bigint not null references appointments(id) on delete cascade,
  reminder_type            text not null default 'three_hours'
                           check (reminder_type in ('three_hours')),
  appointment_scheduled_at timestamptz not null,
  scheduled_for            timestamptz not null,
  client_name              text,
  phone_e164               text,
  service_name             text,
  master_name              text,
  telegram_chat_id         bigint,
  channel                  text not null
                           check (channel in ('telegram','sms','none')),
  fallback_from            text check (fallback_from in ('telegram','sms')),
  status                   text not null default 'processing'
                           check (status in ('processing','sent','delivered','failed','skipped')),
  provider                 text,
  provider_message_id      text,
  provider_status_code     text,
  provider_status_text     text,
  attempt_count            integer not null default 1 check (attempt_count > 0),
  retryable                boolean not null default false,
  next_retry_at            timestamptz,
  attempted_at             timestamptz,
  sent_at                  timestamptz,
  delivered_at             timestamptz,
  error_detail             text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (appointment_id, reminder_type, appointment_scheduled_at)
);

create index if not exists notification_deliveries_created_idx
  on notification_deliveries(created_at desc);
create index if not exists notification_deliveries_sms_status_idx
  on notification_deliveries(status, provider, provider_message_id)
  where channel = 'sms' and provider_message_id is not null;
create index if not exists notification_deliveries_retry_idx
  on notification_deliveries(next_retry_at)
  where status = 'failed' and retryable = true;

alter table notification_contacts enable row level security;
alter table notification_deliveries enable row level security;

-- Intentionally no anon/authenticated policies.  Contact mappings and delivery
-- logs contain personal data and are only accessed by service-role APIs.
revoke all on table notification_contacts from anon, authenticated;
revoke all on table notification_deliveries from anon, authenticated;
revoke all on sequence notification_contacts_id_seq from anon, authenticated;
revoke all on sequence notification_deliveries_id_seq from anon, authenticated;
grant all on table notification_contacts to service_role;
grant all on table notification_deliveries to service_role;
grant usage, select on sequence notification_contacts_id_seq to service_role;
grant usage, select on sequence notification_deliveries_id_seq to service_role;

-- Atomically claims all not-yet-processed appointments that are at most 3h05
-- away.  The slightly wider window and reconciliation approach catch a missed
-- Vercel invocation; the unique key prevents duplicate reminders.
create or replace function claim_due_appointment_reminders(
  p_now timestamptz default now(),
  p_limit integer default 50
) returns setof notification_deliveries
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  with candidates as (
    select
      a.id as appointment_id,
      a.scheduled_at as appointment_scheduled_at,
      a.scheduled_at - interval '3 hours' as scheduled_for,
      a.client_name,
      a.client_phone_e164 as phone_e164,
      a.service_name,
      m.name as master_name,
      c.telegram_chat_id,
      case
        when c.telegram_chat_id is not null then 'telegram'
        when a.client_phone_e164 is not null then 'sms'
        else 'none'
      end as channel
    from appointments a
    join masters m on m.id = a.master_id
    left join lateral (
      select nc.telegram_chat_id
      from notification_contacts nc
      where nc.phone_e164 = a.client_phone_e164
        and nc.telegram_verified_at is not null
        and nc.telegram_blocked_at is null
      limit 1
    ) c on true
    where a.status in ('scheduled', 'confirmed')
      and a.scheduled_at > p_now
      and a.scheduled_at <= p_now + interval '3 hours 5 minutes'
    order by a.scheduled_at
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ), inserted as (
    insert into notification_deliveries (
      appointment_id, reminder_type, appointment_scheduled_at,
      scheduled_for, client_name, phone_e164, service_name, master_name,
      telegram_chat_id, channel, status, provider, attempted_at
    )
    select
      c.appointment_id, 'three_hours', c.appointment_scheduled_at,
      c.scheduled_for, c.client_name, c.phone_e164, c.service_name,
      c.master_name, c.telegram_chat_id, c.channel, 'processing',
      case c.channel when 'telegram' then 'telegram' when 'sms' then 'sms_ru' else null end,
      p_now
    from candidates c
    on conflict (appointment_id, reminder_type, appointment_scheduled_at) do nothing
    returning *
  )
  select * from inserted;

  -- Retry only failures explicitly marked transient by the sender.  A row is
  -- claimed by flipping it back to processing under a row lock.
  return query
  with retry_ids as (
    select d.id
    from notification_deliveries d
    join appointments a on a.id = d.appointment_id
    where d.status = 'failed'
      and d.retryable = true
      and d.attempt_count < 3
      and coalesce(d.next_retry_at, p_now) <= p_now
      and a.status in ('scheduled', 'confirmed')
      and a.scheduled_at > p_now
    order by d.next_retry_at nulls first, d.id
    for update of d skip locked
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ), retried as (
    update notification_deliveries d
    set status = 'processing',
        attempt_count = d.attempt_count + 1,
        retryable = false,
        next_retry_at = null,
        attempted_at = p_now,
        updated_at = p_now,
        error_detail = null
    from retry_ids r
    where d.id = r.id
    returning d.*
  )
  select * from retried;
end;
$$;

revoke all on function claim_due_appointment_reminders(timestamptz, integer) from public, anon, authenticated;
grant execute on function claim_due_appointment_reminders(timestamptz, integer) to service_role;
