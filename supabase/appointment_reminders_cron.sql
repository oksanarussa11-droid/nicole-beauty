-- Nicole Beauty — production scheduler for 3-hour appointment reminders.
--
-- The value itself must be provisioned separately in Supabase Vault as
-- `appointment_reminder_cron_secret`. Never paste it into this file.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'appointment-reminders-every-5-min') then
    perform cron.unschedule('appointment-reminders-every-5-min');
  end if;
end;
$$;

select cron.schedule(
  'appointment-reminders-every-5-min',
  '*/5 * * * *',
  $job$
    select net.http_get(
      url := 'https://nicole-beauty.vercel.app/api/appointment-reminders',
      headers := jsonb_build_object(
        'Authorization',
        'Bearer ' || coalesce((
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'appointment_reminder_cron_secret'
          limit 1
        ), '')
      ),
      timeout_milliseconds := 15000
    ) as request_id;
  $job$
);
