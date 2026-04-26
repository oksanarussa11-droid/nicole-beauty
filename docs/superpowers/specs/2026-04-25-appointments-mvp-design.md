# Appointments MVP — Design (Session 4 from ROADMAP)

**Status:** approved scope, pending implementation plan
**Date:** 2026-04-25

## Goal

Add a future-booking system on top of the existing retroactive `attendances` flow.
Admin can create, confirm, complete, or cancel appointments. Each master sees her own
upcoming appointments on `/register` and can self-complete them with her PIN.
Completing an appointment atomically creates a row in `attendances` so the
existing dashboard, reports, and CSV export pick it up unchanged.

Out of scope (deferred to future sessions): visual calendar grid, drag-and-drop
re-scheduling, day-before Telegram reminders (cron), `clients` CRM table, RLS
restriction by `master_id`.

## Architecture

```
Admin UI (index.html / Агенда)
  ├─ POST   /api/appointment              → INSERT  appointments
  ├─ PATCH  /api/appointment              → UPDATE  appointments.status
  └─ POST   /api/appointment?action=complete
                                          → RPC     complete_appointment()
                                            ├─ INSERT attendances (atomic)
                                            └─ UPDATE appointments.status='completed', .attendance_id

Master UI (register.html / Мои записи)
  ├─ SELECT (anon)                        → list own future appointments
  └─ POST   /api/appointment?action=complete  (gated by PIN)
```

All writes go through `api/appointment.js` using the service-role key. The browser
only ever holds the anon key. Authentication mirrors existing endpoints:
`admin_password` from `sessionStorage[ADMIN_PW_KEY]` for admin actions,
`pin + master_id` for master self-complete (subject to the same `pin_attempts`
rate limit as `attendance.js`).

## Data Model

New migration via `supabase migration new appointments_create_table` →
`supabase/migrations/<timestamp>_appointments_create_table.sql`. Idempotent
(`if not exists`, `or replace`). Applied locally with `supabase db reset` before
ever being pushed to prod.

```sql
create table if not exists appointments (
  id                bigserial primary key,
  scheduled_at      timestamptz not null,
  duration_minutes  integer,                 -- nullable, reserved for v2 overlap detection
  master_id         bigint not null references masters(id) on delete restrict,
  service_id        bigint references services(id) on delete set null,
  service_name      text,                    -- snapshot, survives service rename
  estimated_price   numeric(12,2),
  client_name       text,
  client_phone      text,
  status            text not null default 'scheduled'
                    check (status in ('scheduled','confirmed','completed','cancelled','no_show')),
  attendance_id     bigint references attendances(id) on delete set null,
  note              text,
  created_at        timestamptz not null default now(),
  created_by        text                     -- 'admin' | 'master:<id>' for audit
);

create index if not exists appointments_scheduled_idx on appointments(scheduled_at);
create index if not exists appointments_master_idx   on appointments(master_id);
create index if not exists appointments_status_idx   on appointments(status);

-- Conflict guard: same master cannot have two active bookings at the exact same instant.
-- Partial index ignores cancelled/completed/no_show so a slot can be reused after cancel.
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
```

### Atomic-completion RPC

```sql
create or replace function complete_appointment(
  p_appt_id            bigint,
  p_final_price        numeric,
  p_payment_method     text,
  p_uses_salon_products boolean
) returns bigint
language plpgsql
security definer            -- service-role bypasses RLS anyway, but explicit
as $$
declare
  v_appt          appointments%rowtype;
  v_ms            master_services%rowtype;
  v_commission_pct numeric(5,2);
  v_master_pay    numeric(12,2);
  v_service_name  text;
  v_attendance_id bigint;
begin
  select * into v_appt from appointments where id = p_appt_id for update;
  if not found then
    raise exception 'appointment % not found', p_appt_id;
  end if;
  if v_appt.status not in ('scheduled','confirmed') then
    raise exception 'appointment % is %, cannot complete', p_appt_id, v_appt.status;
  end if;

  select * into v_ms
    from master_services
    where master_id = v_appt.master_id and service_id = v_appt.service_id
    limit 1;
  if not found then
    raise exception 'service not configured for this master';
  end if;

  v_commission_pct := case
    when p_uses_salon_products then v_ms.commission_master_pct_salon
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
    v_appt.master_id, v_appt.service_id, coalesce(v_appt.service_name, v_service_name),
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
```

The RPC is the single atomic primitive. The serverless `/api/appointment?action=complete`
authorizes the caller (admin or master+PIN) then calls `POST /rest/v1/rpc/complete_appointment`
via service-role.

Notes on `attendances.source`: existing values are `'pro_form' | 'ocr' | 'admin'`. The RPC
inserts `'appointment'` as a fourth value. The `attendances.source` column is a free-text
field with no CHECK constraint, so this requires no schema change.

## Timezone

Salon is in **Samara** (`Europe/Samara`, fixed `+04:00`, no DST). Browser sends
`scheduled_at` as a wall-clock string (`YYYY-MM-DDTHH:mm`) from a `<input type="datetime-local">`.
The serverless endpoint appends `+04:00` before forwarding to PostgREST, so the
`timestamptz` column always stores the correct absolute instant regardless of where
the admin's browser is.

For display, browsers in Samara render `timestamptz` values in local time correctly
with no extra code. Browsers outside Samara (e.g. me debugging) see their local time —
acceptable for the MVP since both real users (admin + masters) live in Samara.

The RPC converts back via `at time zone 'Europe/Samara'` when extracting `date` and
`time` for the `attendances` row, so the dashboard's per-day grouping stays aligned
with the salon's calendar day, never with UTC.

## Endpoint: `api/appointment.js`

Single Vercel function dispatching by `req.method` + `?action`:

| Method | URL | Purpose | Gate | Required body |
|--------|-----|---------|------|---------------|
| `POST` | `/api/appointment` | Create | `admin_password` OR `pin + master_id` | `scheduled_at_local`, `master_id`, `service_id`, `estimated_price?`, `client_name?`, `client_phone?`, `note?` |
| `PATCH` | `/api/appointment` | Status change | `admin_password` | `id`, `status` ∈ `{confirmed, cancelled, no_show}` |
| `POST` | `/api/appointment?action=complete` | Complete (RPC) | `admin_password` OR `pin + master_id` | `id`, `final_price`, `payment_method?`, `uses_salon_products?` |

Helpers reused (copied — same posture as the rest of the codebase, no shared module):

- `sb(method, path, body)` — PostgREST proxy, identical to `attendance.js`
- `verifyPin(pin, hash)` — scrypt constant-time comparison
- Rate-limit via `pin_attempts` (5/min per master)
- `escMd(s)` — Telegram Markdown escape
- `clientIp(req)` — for audit

Validation rules:

- `scheduled_at_local` matches `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$`; server appends `:00+04:00`
- `master_id` and `service_id` exist (foreign-key check is server-enforced anyway)
- `estimated_price` (if provided) bounded by `master_services.price * 10` to mirror `attendance.js` price-sanity check
- For master-gated calls, `master_id` in the body must equal the PIN-verified master to prevent a master from completing another's appointment
- `final_price` (in complete) > 0 and finite

Conflict response: when the unique index trips, PostgREST returns `409`. Endpoint
catches the unique-violation and returns `409 { error: 'Slot already booked' }`.

## Telegram notifications

On **create** (POST) and on **complete** (action=complete), with `await fetch` and the
3-second `AbortController` timeout, mirroring the post-fix pattern from
`attendance.js` (commit `a03fae5`). Messages:

- **Create:** `📅 *Новая бронь*\n\n*Мастер:* Людмила\n*Услуга:* Окрашивание\n*Когда:* 28.04 в 14:00\n*Клиент:* Мария\n_Оценка: 5000 ₽_`
- **Complete:** `✅ *Бронь выполнена*\n\n*Мастер:* …\n*Услуга:* …\n*Цена:* … ₽\n*Мастеру:* … ₽ (50%)`

No notification on PATCH (confirm/cancel/no_show) — keeps Telegram low-noise. Tunable later.

## UI: admin tab "Агенда"

Inserted between "Записи" and "Финансы" in `index.html`:

```html
<div class="tab" data-section="schedule">Агенда</div>
```

Section contents:

- **Filter bar:** date-from, date-to (default: today → today+7), master dropdown ("Все"), status filter chips (Все · Активные · Завершённые · Отменённые)
- **Card "Новая запись":** form with `<input type="datetime-local">`, master dropdown, service dropdown (filtered to `master_services` for selected master, with auto-fill of estimated_price from the row's `price`), client name, client phone, note, "Создать"
- **Card "Расписание":** list grouped by day (day header in Cormorant, slots stacked under it). Each slot row: time · master pill (color from existing palette) · service · client · estimated_price · status badge · actions:
  - **Подтверждено** (only when status='scheduled') → PATCH status='confirmed'
  - **Выполнено** (status ∈ scheduled/confirmed) → opens inline mini-form (final_price prefilled with estimated_price, payment_method dropdown, uses_salon_products checkbox), submits action=complete
  - **Отмена** (status ∈ scheduled/confirmed) → confirm dialog → PATCH status='cancelled'

State additions in `index.html`:

```js
state.appointments = []; // [{ id, scheduled_at, master_id, service_id, service_name,
                          //   estimated_price, client_name, client_phone, status,
                          //   attendance_id, note }]
```

Loaded by `loadAll()` alongside the existing eight entities. Refetched after every
mutation. After a successful "Выполнено" the dashboard's existing `unifiedTotals()`
already picks up the new attendance — no special wiring needed.

## UI: master card "Мои записи" on `/register`

Inserted **between "Сегодня" and "История"** (chronological logic: future before past),
default-collapsed `<details>` with the count in the summary (`Мои записи (3)`).

Read query (anon, after login):

```js
sb.from('appointments')
  .select('id, scheduled_at, service_name, services!inner(name), estimated_price, client_name, status, master_id')
  .eq('master_id', session.masterId)
  .gte('scheduled_at', new Date().toISOString())
  .in('status', ['scheduled', 'confirmed'])
  .order('scheduled_at', { ascending: true });
```

Each item shows date · time · client · service · estimated_price · "Выполнено" button.
Clicking "Выполнено" opens an inline mini-form (final_price + payment_method +
uses_salon_products checkbox — same widgets as the master's existing today-entry form),
submits to `/api/appointment?action=complete` with PIN. On success: refetch list,
refetch today's attendances (the new row appears in "Сегодня" automatically), toast
"Запись выполнена".

No "Cancel" or "Confirm" buttons on the master side in MVP — masters can't cancel their
own bookings (matches salon practice: cancellation goes through admin).

## Files touched

**Create:**

- `supabase/migrations/<timestamp>_appointments_create_table.sql`
- `api/appointment.js`

**Modify:**

- `index.html` — new tab, new section, new state field, new render functions, hook into `loadAll()`/`renderAll()`
- `register.html` — new card, new render function, hook into `showEntryUI()` and post-save flow
- `README.md` — short paragraph in the section catalog at the bottom (consistent with how Telegram and the report viewer are documented)

**Do not touch:**

- `supabase/schema.sql` (legacy snapshot; migrations are the source of truth now)
- `config.js` (auto-switches local/prod; do not alter)
- `vercel.json` (subdomain swap is fine as-is)

## Verification

Local before any push:

1. `supabase migration new appointments_create_table` → write DDL → `supabase db reset` applies cleanly with no warnings
2. `vercel dev` running on `:3000`
3. Admin tab Агенда: create an appointment for Людмила tomorrow 14:00, Окрашивание, Мария → row appears in the list
4. Master /register tab in incognito: log in as Людмила → "Мои записи" shows the booking
5. Admin clicks "Выполнено" → fill final price 5200, payment Карта, uses_salon_products false → success
6. Inspect via `psql postgresql://postgres:postgres@127.0.0.1:54322/postgres`:
   - `appointments.status` = `'completed'`, `attendance_id` populated
   - `attendances` row created with correct `master_pay = 5200 * commission_master_pct / 100`
7. Admin Записи tab: dashboard total includes the new attendance
8. Admin Отчёты tab: report range includes the new attendance
9. Conflict path: try to create a second appointment for same master + same `scheduled_at` → endpoint returns 409, UI shows "Slot already booked"
10. Cancel path: cancel an appointment → status='cancelled', re-creating the same slot now succeeds (partial index excludes cancelled rows)
11. Master self-complete in incognito: log in, click "Выполнено" on a booking → success, attendance created, `appointments.status` updated
12. `node --check` on each modified script block (extract via `python3 -c "import sys, re; print(re.findall(r'<script>(.*?)</script>', open(sys.argv[1]).read(), re.S)[-1])" file.html | node --check -`)
13. Telegram dry-run: with `TELEGRAM_BOT_TOKEN` unset locally, the endpoint logs "skipped" and still returns 200 — no breakage

Only after all 13 pass: ask user before `supabase db push` and `git push`.

## Risk register

- **TZ drift if Russia ever brings DST back:** `Europe/Samara` IANA name handles that automatically; the only place hardcoded `+04:00` appears is the serverless endpoint. If DST returns, switch the endpoint to compute the offset from `Intl.DateTimeFormat('en', { timeZone: 'Europe/Samara', timeZoneName: 'short' })`. Low probability.
- **Service-name drift:** `appointments.service_name` is snapshot-at-create. The RPC writes `coalesce(v_appt.service_name, v_service_name)` so the snapshot wins — if the service is renamed between booking and completion, both `appointments.service_name` and `attendances.service_name` keep the booking-time label. The fallback to `services.name` only kicks in when the snapshot is null (legacy rows). Consistent and predictable.
- **Master self-completes a no-show:** master could theoretically click Выполнено after the client never showed. Same trust model as today's `/register` entry — masters are trusted with PIN-gated entries. Admin can correct by deleting the attendance.
- **PostgREST 409 vs other errors:** unique-violation surfaces as PostgreSQL error code `23505`. Endpoint must inspect the error body (PostgREST returns `{ code: "23505" }`) rather than relying on HTTP status alone.
