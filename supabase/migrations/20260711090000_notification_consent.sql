-- Explicit consent for service reminders.

alter table appointments
  add column if not exists notification_consent_at timestamptz,
  add column if not exists notification_consent_version text;

alter table booking_requests
  add column if not exists notification_consent_at timestamptz,
  add column if not exists notification_consent_version text;

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
        -- Sharing one's own contact with the bot is the Telegram opt-in.
        when c.telegram_chat_id is not null then 'telegram'
        -- SMS is allowed only after explicit consent captured at booking.
        when a.notification_consent_at is not null then 'sms'
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
