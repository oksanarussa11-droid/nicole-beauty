# Appointments — master self-service (create / reschedule / cancel)

**Date:** 2026-04-26
**Status:** Design — pending implementation
**Builds on:** [`2026-04-25-appointments-mvp-design.md`](2026-04-25-appointments-mvp-design.md) — appointments MVP shipped at PR #1 (`eef3b64`).

## Motivation

The MVP (Session 4) made appointment creation/edit admin-only and restricted masters to **completing** their own appointments via `/register`. Real-world salon workflow: masters book and reshuffle their own clients on the fly; the admin role is supervision and reporting, not gatekeeping every booking. This spec extends the existing endpoints + `/register` UI to give each master autonomy over **their own** schedule.

## Scope

In scope:
- Master creates an appointment **for themselves** via `/register`.
- Master cancels their own non-terminal appointment.
- Master reschedules (changes `scheduled_at`) of their own non-terminal appointment.
- Server-side enforcement that a master cannot affect another master's row.

Out of scope:
- Master booking on behalf of another master (covering colleague). Admin-only.
- Master changing service / price / client of an existing appointment. (Cancel+create instead.)
- Master setting status to `confirmed` / `no_show`. Admin-only.
- Schema changes — none.

## Non-goals

- No new tables, no new RPCs, no new RLS policies.
- No "true" reschedule animation or undo. PATCH is one-shot.
- No SMS/email — Telegram only, same channel as MVP.

## Architecture / data model

**Unchanged.** Reuses:
- `appointments` table.
- Partial unique index `appointments_master_slot_uniq` on `(master_id, scheduled_at)` `WHERE status IN ('scheduled', 'confirmed')` — already enforces conflicts on create *and* on UPDATE of `scheduled_at`.
- RLS: `anon_select_appointments` (read-only). All writes go through `api/appointment.js` with the service-role key.
- `complete_appointment` RPC (already exists; not touched here).

## Backend — `api/appointment.js`

### POST `/api/appointment` (create)

**Already supported server-side** — `handleCreate` accepts both admin and master+pin auth today; if `auth.kind === 'master'`, line 175 of `api/appointment.js` already enforces `body.master_id === auth.masterId` (rejects mismatch with 403, doesn't silently override). No backend change needed for create.

The `created_by` column will record `master:<id>` for master-originated rows (already implemented at line 205) — admin Агенда can use this to flag self-service bookings.

The work for "create" is therefore **frontend-only** — wire the new form in `register.html` to POST with `master_id`+`pin` from sessionStorage.

### PATCH `/api/appointment`

Today (line 252 of `api/appointment.js`): hard-coded admin-only — explicitly requires `admin_password` and rejects all other callers with 401. Accepts only `{ id, status }` with status ∈ `{confirmed, cancelled, no_show}`.

Change — replace the inline `admin_password` check with `await authorize(body, req)` (the same helper used by create + complete), then add per-kind guards. Also accept a new `scheduled_at_local` operation:

**Body shape (XOR — exactly one of these two operations per request):**

```jsonc
// Operation A: change status
{ "id": <bigint>, "status": "cancelled" | "confirmed" | "no_show" }

// Operation B: reschedule
{ "id": <bigint>, "scheduled_at_local": "YYYY-MM-DDTHH:mm" }
```

**Authorization matrix:**

| Operation              | admin | master (own row) | master (other row) |
|------------------------|-------|------------------|--------------------|
| `status: cancelled`    | ✓     | ✓                | 403                |
| `status: confirmed`    | ✓     | 403              | 403                |
| `status: no_show`      | ✓     | 403              | 403                |
| `scheduled_at_local`   | ✓     | ✓                | 403                |

**Pre-conditions** (apply to all PATCH):
- Body must have exactly one of `status` / `scheduled_at_local`. Both or neither → **400** `"Exactly one of status or scheduled_at_local required"`.
- Target row must exist → **404**.
- Target row's `status` must be `scheduled` or `confirmed`. Terminal (`completed`/`cancelled`/`no_show`) → **409** `"Cannot edit terminal appointment"`.
- For master+pin: target row's `master_id === auth.masterId` → otherwise **403** `"This appointment belongs to another master"` (same wording as `?action=complete`).
- For master+pin: if status, only `cancelled` allowed; otherwise **403** `"Master can only cancel"`.

**Reschedule semantics:**
- Convert `scheduled_at_local` to UTC using the same `SAMARA_OFFSET` constant (`+04:00`) used by create.
- `UPDATE appointments SET scheduled_at = $new WHERE id = $id`.
- The partial unique index will throw `23505` on conflict → catch → **409** `"Slot already booked for this master"` (same wording as create).

**Telegram notifications:**
- On successful cancel → `❌ Запись отменена\n{master_name} · {fmtSamara(scheduled_at)}\n{client_name || '—'}`.
- On successful reschedule → `🔁 Запись перенесена\n{master_name} · {fmtSamara(old)} → {fmtSamara(new)}\n{client_name || '—'}`.
- Same fire-and-forget `notifyTelegram` helper as MVP — no-op when `TELEGRAM_BOT_TOKEN` empty.

### Response shapes

| Result                | Body                                                                                  |
|-----------------------|---------------------------------------------------------------------------------------|
| Cancel ok             | `{ "ok": true, "id": <id>, "status": "cancelled" }`                                   |
| Status change ok      | `{ "ok": true, "id": <id>, "status": <new_status> }` (existing admin behavior)        |
| Reschedule ok         | `{ "ok": true, "id": <id>, "scheduled_at": "<iso>" }`                                 |
| 400 / 403 / 404 / 409 | `{ "error": "<message>" }`                                                            |

## Frontend — `register.html`

### New card: "Новая запись"

Placement: inside the master gate, **above** the existing "Мои записи" card.

Fields (mirror admin's create form, minus the master selector):

| Label                  | Field id            | Type            | Notes                                                                 |
|------------------------|---------------------|-----------------|-----------------------------------------------------------------------|
| Дата и время           | `mApptWhen`         | datetime-local  | min = now (Samara local)                                              |
| Услуга                 | `mApptService`      | select          | populated from `master_services` ∩ `services` for the logged master   |
| Оценка цены, ₽         | `mApptPrice`        | number          | auto-filled from `master_services.price` on service change; editable  |
| Клиент                 | `mApptClient`       | text (200)      |                                                                       |
| Телефон                | `mApptPhone`        | text (40, tel)  |                                                                       |
| Заметка                | `mApptNote`         | text (500)      | full-width                                                            |

Submit handler:
1. Validate datetime-local ≥ now.
2. Build payload `{ master_id: <session>, pin: <session>, scheduled_at_local, service_id, estimated_price, client_name, client_phone, note }`.
3. POST `/api/appointment`.
4. On 200 → toast "Запись создана", clear form, refresh "Мои записи" list.
5. On 409 → toast "Слот уже занят" (red).
6. On 401 → toast "Неверный PIN, войдите снова" + force re-login (clear sessionStorage).
7. Other → toast server message.

### "Мои записи" enhancements

Filter list to `status IN ('scheduled', 'confirmed')`. Completed/cancelled rows already live in the existing "История" card — no change needed there.

Each row gains, alongside the existing `[Выполнено]` button:

- `[Перенести]` — toggles an inline `<input type="datetime-local">` with `[Сохранить]` `[Отмена]`. Save → PATCH `{ id, scheduled_at_local }`. On 409 → toast conflict, leaves form open. On 200 → close form, refresh.
- `[Отмена]` — `confirm("Отменить запись?")` → PATCH `{ id, status: 'cancelled' }`. On 200 → row disappears (filtered out).

Auth payload for both PATCH calls: same `{ master_id, pin }` from sessionStorage.

### Visual

Reuse existing `.card` / form styles from `register.html` and admin Агенда. No new CSS classes needed.

## Error handling

| Cause                        | HTTP | UI toast                                                |
|------------------------------|------|---------------------------------------------------------|
| Bad PIN                      | 401  | "Неверный PIN, войдите снова" + clear session          |
| Cross-master attempt         | 403  | "Эта запись принадлежит другому мастеру" (defensive)   |
| Status not allowed for master| 403  | "Master can only cancel" (defensive — UI never sends)  |
| Slot conflict                | 409  | "Слот уже занят"                                        |
| Terminal appointment edit    | 409  | "Запись уже завершена или отменена"                    |
| Bad request                  | 400  | server message verbatim                                 |
| 5xx                          | 500  | "Ошибка сервера, попробуйте позже"                     |

## Testing — verification checklist

Manual E2E walk against local stack (admin password `dev`, master `Тест Мастер` PIN `1234`, second master `Тест Мастер 2` PIN `5678`):

1. **Master create own** — `/register` → fill form → "Создать" → row in "Мои записи".
2. **Admin sees it** — admin Агенда tab → row visible; DB `created_by` like `master:<id>`.
3. **Conflict on create** — master tries same slot again → toast "Слот уже занят".
4. **Master reschedule** — click `[Перенести]` → pick new datetime → save → row updates in place (same `id`, new `scheduled_at`).
5. **Reschedule conflict** — try to reschedule onto an already-occupied slot → 409, form stays open.
6. **Master cancel** — click `[Отмена]` → confirm → row disappears from list; DB shows `status='cancelled'`.
7. **Cross-master block** — `curl -X PATCH` with `master_id` of master 2 + valid PIN of master 2, targeting an appointment of master 1 → **403**.
8. **Terminal-edit block** — admin completes an appointment; master tries `[Перенести]` on it (or curl PATCH on a `completed` row) → **409**.
9. **Telegram** — with `TELEGRAM_BOT_TOKEN` exported, repeat create/cancel/reschedule and observe three distinct messages (📅 created, ❌ cancelled, 🔁 rescheduled).

## Migration / rollout

- No DB migration.
- Single deploy: backend (`api/appointment.js` PATCH extension) + frontend (`register.html`) ship together.
- Backwards compatibility: existing admin PATCH (`{id, status}`) and existing master self-complete (`?action=complete`) are unaffected.

## Open questions

None. All resolved during brainstorming on 2026-04-26.
