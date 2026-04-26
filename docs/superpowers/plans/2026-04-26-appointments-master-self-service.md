# Appointments — master self-service implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let masters create / cancel / reschedule **their own** appointments via `/register`, with admin retaining supervisory powers.

**Architecture:** No schema change. Backend: extend `handlePatch` in `api/appointment.js` to accept master+pin auth (currently admin-only) and a new `scheduled_at_local` reschedule operation. Frontend: add a "Новая запись" form card to `register.html` + per-row Cancel/Reschedule buttons in the existing "Мои записи" card.

**Tech Stack:** Node.js Vercel function, Supabase REST/RLS, vanilla JS in `register.html`, Telegram Bot API.

**Spec:** [`docs/superpowers/specs/2026-04-26-appointments-master-self-service-design.md`](../specs/2026-04-26-appointments-master-self-service-design.md)

**Branch:** `feat/appointments-master-self-service` (already created, spec already committed at `902f0b5`).

---

## Environment setup (run once before Task 1)

```bash
cd "/Users/oksana/Documents/Claude/Projects/Nicole Beauty"
export PATH="/opt/homebrew/opt/libpq/bin:$PATH"

# Supabase + vercel dev should be running. Sanity-check:
supabase status >/dev/null && echo "supabase OK"
curl -s -o /dev/null -w "vercel dev: %{http_code}\n" http://localhost:3000/api/appointment   # expect 405

# Test data — set PIN 1234 on master 1, create master 2 with PIN 5678 (cleaned up at the end).
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
UPDATE masters SET pin_hash='bcfe8e2013f1f297d00b8c844e7133a3:1a10a742781d7461c72731606f4393e50e18d4325c056650d572962b904a692e5f9a654ae1ad2836295e8aa31295afe62ff3ae13f6c6924f0f1d69d33994f1cd' WHERE id=1;
INSERT INTO masters (name, specialty, active, pin_hash) VALUES ('Тест Мастер 2', 'colorist', true, 'adc6ea63b6e05693c581a1763a787d54:575df0dfb41f5c0089b6207fadcc6364e68ba617ddcce19b76f8cf0e76eaceba7aa5285c99a7508657141c57e0472b68f714caf8628ac1dcaded8aba61ae7c61')
ON CONFLICT (name) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, active=true;
UPDATE master_services SET price=4000, commission_master_pct=50, commission_master_pct_salon=40
  WHERE master_id=(SELECT id FROM masters WHERE name='Тест Мастер 2') AND service_id=1;
SQL
```

PINs: master 1 = `1234`, master 2 = `5678`. Admin password = `dev`. Both PINs/passwords are local-only, never deployed.

---

## Task 1: Backend — PATCH accepts master+pin (cancel-only path)

Replace the inline `admin_password` check in `handlePatch` with the shared `authorize()` helper, then add per-kind guards. Master can only call `status: 'cancelled'`. Reschedule comes in Task 2.

**Files:**
- Modify: `api/appointment.js:252-279` (the entire `handlePatch` body)

- [ ] **Step 1.1: Replace `handlePatch` with the new auth flow**

Open `api/appointment.js` and replace lines 252–279 (the `handlePatch` function as-is) with:

```js
async function handlePatch(body, req) {
  const auth = await authorize(body, req);

  const id = parseInt(body.id);
  if (!id) { const e = new Error('id is required'); e.status = 400; throw e; }

  const hasStatus = body.status !== undefined && body.status !== null && body.status !== '';
  const hasReschedule = body.scheduled_at_local !== undefined && body.scheduled_at_local !== null && body.scheduled_at_local !== '';
  if (hasStatus === hasReschedule) {
    const e = new Error('Exactly one of status or scheduled_at_local required'); e.status = 400; throw e;
  }

  // Re-fetch first so we can refuse no-op transitions and preserve the unique-index invariant.
  const rows = await sb('GET', `appointments?select=id,master_id,scheduled_at,status,service_name,client_name&id=eq.${id}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) { const e = new Error('Appointment not found'); e.status = 404; throw e; }
  if (!['scheduled', 'confirmed'].includes(row.status)) {
    const e = new Error('Cannot edit terminal appointment'); e.status = 409; throw e;
  }

  // Master can only touch their own row, and only to cancel.
  if (auth.kind === 'master') {
    if (row.master_id !== auth.masterId) {
      const e = new Error('This appointment belongs to another master'); e.status = 403; throw e;
    }
    if (hasStatus && String(body.status) !== 'cancelled') {
      const e = new Error('Master can only cancel'); e.status = 403; throw e;
    }
  }

  if (hasStatus) {
    const status = String(body.status);
    const allowed = ['confirmed', 'cancelled', 'no_show'];
    if (!allowed.includes(status)) {
      const e = new Error('status must be one of: ' + allowed.join(', ')); e.status = 400; throw e;
    }
    await sb('PATCH', `appointments?id=eq.${id}`, { status });
    return { ok: true, id, status };
  }

  // hasReschedule branch — Task 2 fills this in.
  const e = new Error('Reschedule not yet implemented'); e.status = 501; throw e;
}
```

- [ ] **Step 1.2: Syntax check**

```bash
node --check api/appointment.js
```
Expected: exits 0 with no output.

- [ ] **Step 1.3: Verify admin path still works (cancel)**

First create a fresh appointment to cancel:
```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T09:00\",\"service_id\":1,\"client_name\":\"T1-admin-cancel\"}"
```
Capture `id` from response. Then:
```bash
curl -s -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d '{"admin_password":"dev","id":<ID>,"status":"cancelled"}'
```
Expected: `{"ok":true,"id":<ID>,"status":"cancelled"}`.

- [ ] **Step 1.4: Verify master can cancel own appointment**

Create one as master, then cancel as master:
```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"scheduled_at_local\":\"${TOMORROW}T10:00\",\"service_id\":1,\"client_name\":\"T1-master-cancel\"}"
# capture id, then:
curl -s -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d '{"master_id":1,"pin":"1234","id":<ID>,"status":"cancelled"}'
```
Expected: `{"ok":true,"id":<ID>,"status":"cancelled"}`.

- [ ] **Step 1.5: Verify cross-master block**

Create as master 1, try to cancel as master 2:
```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T11:00\",\"service_id\":1,\"client_name\":\"T1-cross\"}"
# capture id, then:
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d '{"master_id":2,"pin":"5678","id":<ID>,"status":"cancelled"}'
cat /tmp/r.json
```
Expected: `HTTP 403` and `{"error":"This appointment belongs to another master"}`.

- [ ] **Step 1.6: Verify master cannot use disallowed statuses**

```bash
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d '{"master_id":1,"pin":"1234","id":<ANY_OWN_ACTIVE_ID>,"status":"confirmed"}'
cat /tmp/r.json
```
Expected: `HTTP 403` and `{"error":"Master can only cancel"}`.

- [ ] **Step 1.7: Verify XOR (both fields) rejected**

```bash
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d '{"admin_password":"dev","id":1,"status":"cancelled","scheduled_at_local":"2026-04-30T10:00"}'
cat /tmp/r.json
```
Expected: `HTTP 400` and `{"error":"Exactly one of status or scheduled_at_local required"}`.

- [ ] **Step 1.8: Cleanup test rows + commit**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from appointments where client_name like 'T1-%';"

git add api/appointment.js
git commit -m "$(cat <<'EOF'
feat(schedule): PATCH /api/appointment — master+pin auth (cancel only)

handlePatch now uses the shared authorize() helper. Masters can call
PATCH to cancel their own appointments; admins keep full control.
Reschedule (scheduled_at_local) returns 501 — implemented in next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Backend — PATCH reschedule operation

Add the `scheduled_at_local` branch in `handlePatch`. Convert local time to UTC, UPDATE the row, translate the partial-unique-index 23505 to HTTP 409.

**Files:**
- Modify: `api/appointment.js` (the `// hasReschedule branch — Task 2 fills this in.` block from Task 1)

- [ ] **Step 2.1: Replace the 501 stub with the reschedule logic**

Find this block at the end of `handlePatch`:

```js
  // hasReschedule branch — Task 2 fills this in.
  const e = new Error('Reschedule not yet implemented'); e.status = 501; throw e;
}
```

Replace with:

```js
  // Reschedule branch
  const scheduledLocal = String(body.scheduled_at_local);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledLocal)) {
    const e = new Error('scheduled_at_local must be YYYY-MM-DDTHH:mm'); e.status = 400; throw e;
  }
  const newScheduledAt = scheduledLocal + ':00' + SAMARA_OFFSET;

  try {
    await sb('PATCH', `appointments?id=eq.${id}`, { scheduled_at: newScheduledAt });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const conflictErr = new Error('Slot already booked for this master');
      conflictErr.status = 409; throw conflictErr;
    }
    throw e;
  }

  return { ok: true, id, scheduled_at: newScheduledAt };
}
```

- [ ] **Step 2.2: Syntax check**

```bash
node --check api/appointment.js
```
Expected: exits 0.

- [ ] **Step 2.3: Verify master can reschedule own appointment**

```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
DAY_AFTER=$(date -v+2d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"scheduled_at_local\":\"${TOMORROW}T13:00\",\"service_id\":1,\"client_name\":\"T2-resched\"}"
# capture id, then:
curl -s -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"id\":<ID>,\"scheduled_at_local\":\"${DAY_AFTER}T13:00\"}"
```
Expected: `{"ok":true,"id":<ID>,"scheduled_at":"<DAY_AFTER>T09:00:00+00:00"}` (UTC = local − 4h).

- [ ] **Step 2.4: Verify reschedule conflict**

Create two slots, then try to reschedule the second onto the first:
```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T17:00\",\"service_id\":1,\"client_name\":\"T2-conf-A\"}"
# capture A_ID
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T18:00\",\"service_id\":1,\"client_name\":\"T2-conf-B\"}"
# capture B_ID, then try to move B onto A's slot:
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"id\":<B_ID>,\"scheduled_at_local\":\"${TOMORROW}T17:00\"}"
cat /tmp/r.json
```
Expected: `HTTP 409` and `{"error":"Slot already booked for this master"}`.

- [ ] **Step 2.5: Verify cross-master reschedule blocked**

```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
DAY_AFTER=$(date -v+2d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T19:00\",\"service_id\":1,\"client_name\":\"T2-cross\"}"
# capture id, master 2 attempts:
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":2,\"pin\":\"5678\",\"id\":<ID>,\"scheduled_at_local\":\"${DAY_AFTER}T19:00\"}"
cat /tmp/r.json
```
Expected: `HTTP 403` and `{"error":"This appointment belongs to another master"}`.

- [ ] **Step 2.6: Verify terminal-edit blocked**

Use any completed appointment id (or create+complete one):
```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"admin_password\":\"dev\",\"master_id\":1,\"scheduled_at_local\":\"${TOMORROW}T20:00\",\"service_id\":1,\"client_name\":\"T2-term\"}"
# capture id; complete it as admin:
curl -s -X POST 'http://localhost:3000/api/appointment?action=complete' \
  -H 'Content-Type: application/json' \
  -d '{"admin_password":"dev","id":<ID>,"final_price":3000,"payment_method":"cash"}'
# now try to reschedule it:
curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"id\":<ID>,\"scheduled_at_local\":\"${TOMORROW}T21:00\"}"
cat /tmp/r.json
```
Expected: `HTTP 409` and `{"error":"Cannot edit terminal appointment"}`.

- [ ] **Step 2.7: Cleanup + commit**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from attendances where source='appointment'; delete from appointments where client_name like 'T2-%';"

git add api/appointment.js
git commit -m "$(cat <<'EOF'
feat(schedule): PATCH /api/appointment — scheduled_at_local reschedule

In-place UPDATE of scheduled_at, conflict guarded by the existing
partial unique index. Master+pin authorized callers can reschedule
their own non-terminal appointments.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Backend — Telegram notifications on cancel + reschedule

Add `notifyTelegram` calls inside the cancel and reschedule branches of `handlePatch`. Reuse the same fire-and-forget helper as create/complete; it's a no-op when `TELEGRAM_BOT_TOKEN` is empty.

**Files:**
- Modify: `api/appointment.js` (cancel branch and reschedule branch in `handlePatch`)

- [ ] **Step 3.1: Add cancel notification**

Locate this block in `handlePatch`:
```js
    await sb('PATCH', `appointments?id=eq.${id}`, { status });
    return { ok: true, id, status };
```

Replace with:
```js
    await sb('PATCH', `appointments?id=eq.${id}`, { status });

    if (status === 'cancelled') {
      const masterName = auth.kind === 'master' ? auth.master.name : await fetchMasterName(row.master_id);
      const whenLabel = fmtSamaraLocal(row.scheduled_at);
      await notifyTelegram([
        '❌ *Запись отменена*',
        '',
        `*Мастер:* ${escMd(masterName) || '#' + row.master_id}`,
        `*Услуга:* ${escMd(row.service_name) || '—'}`,
        `*Когда:* ${escMd(whenLabel)}`,
        row.client_name ? `*Клиент:* ${escMd(row.client_name)}` : null,
      ]);
    }

    return { ok: true, id, status };
```

- [ ] **Step 3.2: Add reschedule notification**

Locate this block:
```js
  try {
    await sb('PATCH', `appointments?id=eq.${id}`, { scheduled_at: newScheduledAt });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const conflictErr = new Error('Slot already booked for this master');
      conflictErr.status = 409; throw conflictErr;
    }
    throw e;
  }

  return { ok: true, id, scheduled_at: newScheduledAt };
}
```

Replace with:
```js
  try {
    await sb('PATCH', `appointments?id=eq.${id}`, { scheduled_at: newScheduledAt });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const conflictErr = new Error('Slot already booked for this master');
      conflictErr.status = 409; throw conflictErr;
    }
    throw e;
  }

  const masterName = auth.kind === 'master' ? auth.master.name : await fetchMasterName(row.master_id);
  const oldLabel = fmtSamaraLocal(row.scheduled_at);
  const newLabel = scheduledLocal.replace('T', ' ');
  await notifyTelegram([
    '🔁 *Запись перенесена*',
    '',
    `*Мастер:* ${escMd(masterName) || '#' + row.master_id}`,
    `*Услуга:* ${escMd(row.service_name) || '—'}`,
    `*Было:* ${escMd(oldLabel)}`,
    `*Стало:* ${escMd(newLabel)}`,
    row.client_name ? `*Клиент:* ${escMd(row.client_name)}` : null,
  ]);

  return { ok: true, id, scheduled_at: newScheduledAt };
}
```

- [ ] **Step 3.3: Add helper functions `fetchMasterName` and `fmtSamaraLocal`**

Locate the helpers area (right above `handleCreate`, around line 155). Add these two helpers after the existing `escMd` definition (search for `function escMd`):

```js
async function fetchMasterName(masterId) {
  const rows = await sb('GET', `masters?select=name&id=eq.${masterId}&limit=1`);
  const row = Array.isArray(rows) ? rows[0] : null;
  return row?.name || null;
}

// Convert a UTC ISO timestamp to "YYYY-MM-DD HH:mm" in Samara local time.
function fmtSamaraLocal(isoUtc) {
  const d = new Date(isoUtc);
  // Samara is UTC+4, no DST.
  const samara = new Date(d.getTime() + 4 * 3600 * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${samara.getUTCFullYear()}-${pad(samara.getUTCMonth() + 1)}-${pad(samara.getUTCDate())} ${pad(samara.getUTCHours())}:${pad(samara.getUTCMinutes())}`;
}
```

- [ ] **Step 3.4: Syntax check**

```bash
node --check api/appointment.js
```
Expected: exits 0.

- [ ] **Step 3.5: Smoke-test (no real Telegram needed — no-op when token empty)**

```bash
TOMORROW=$(date -v+1d +%Y-%m-%d)
DAY_AFTER=$(date -v+2d +%Y-%m-%d)
curl -s -X POST 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"scheduled_at_local\":\"${TOMORROW}T22:00\",\"service_id\":1,\"client_name\":\"T3-tg\"}"
# capture id, reschedule:
curl -s -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"id\":<ID>,\"scheduled_at_local\":\"${DAY_AFTER}T22:00\"}"
# now cancel:
curl -s -X PATCH 'http://localhost:3000/api/appointment' \
  -H 'Content-Type: application/json' \
  -d "{\"master_id\":1,\"pin\":\"1234\",\"id\":<ID>,\"status\":\"cancelled\"}"
```
All three should return `{"ok":true,...}` with HTTP 200. With `TELEGRAM_BOT_TOKEN=""` the notifications are no-ops; with the token set you'd see 📅, 🔁, ❌ messages in your channel.

- [ ] **Step 3.6: Cleanup + commit**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from appointments where client_name like 'T3-%';"

git add api/appointment.js
git commit -m "$(cat <<'EOF'
feat(schedule): Telegram notify on cancel + reschedule

Adds ❌ "Запись отменена" and 🔁 "Запись перенесена" messages.
Helpers fetchMasterName() and fmtSamaraLocal() handle admin-initiated
PATCH (where auth.master is unset).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Frontend — "Новая запись" form card markup

Add a new collapsible card to `register.html` between the existing "Сегодня" card and "Мои записи" card. JS handlers added in Task 5.

**Files:**
- Modify: `register.html` (around line 740, after the `todayCard` close `</div>`)

- [ ] **Step 4.1: Insert the form card markup**

Find this block in `register.html` (around line 738–740):
```html
        <span>Итого</span><strong id="todayTotalVal">0 ₽</strong>
      </div>
    </div>

    <!-- ═══ UPCOMING APPOINTMENTS ═══ -->
```

Insert the new card immediately before the `<!-- ═══ UPCOMING APPOINTMENTS ═══ -->` comment:

```html
    <!-- ═══ NEW APPOINTMENT FORM ═══ -->
    <details class="card history-card" id="newApptCard" style="display:none;">
      <summary>
        <h2>Новая запись</h2>
        <span class="history-caret">▾</span>
      </summary>
      <div class="row">
        <div>
          <label class="lbl">Дата и время</label>
          <input class="fld" type="datetime-local" id="mApptWhen">
        </div>
        <div>
          <label class="lbl">Услуга</label>
          <select class="fld" id="mApptService" onchange="onMApptServiceChange()"></select>
        </div>
        <div>
          <label class="lbl">Оценка цены, ₽</label>
          <input class="fld" type="number" id="mApptPrice" step="50" min="0">
        </div>
        <div>
          <label class="lbl">Клиент</label>
          <input class="fld" type="text" id="mApptClient" maxlength="200">
        </div>
        <div>
          <label class="lbl">Телефон</label>
          <input class="fld" type="text" id="mApptPhone" maxlength="40" inputmode="tel">
        </div>
        <div style="grid-column:1/-1;">
          <label class="lbl">Заметка</label>
          <input class="fld" type="text" id="mApptNote" maxlength="500">
        </div>
      </div>
      <div style="margin-top:10px;">
        <button class="btn" type="button" onclick="submitNewAppointment()">Создать</button>
      </div>
    </details>

    <!-- ═══ UPCOMING APPOINTMENTS ═══ -->
```

- [ ] **Step 4.2: Verify markup serves**

```bash
curl -s http://localhost:3000/register | grep -c 'id="newApptCard"'
```
Expected: `1`.

- [ ] **Step 4.3: Commit**

```bash
git add register.html
git commit -m "$(cat <<'EOF'
feat(schedule): pro /register — Новая запись card markup

Static markup only (form fields + Создать button). JS wiring lands in
the next commit.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Frontend — wire create handler + show card after login

Populate the service select from `state.masterServices`, auto-fill price on service change, POST on submit.

**Files:**
- Modify: `register.html` script block

- [ ] **Step 5.1: Find a clean insertion point near the upcoming-card handlers**

Open `register.html` and locate `function openSelfComplete(id)` (around line 938). The new helpers go just before it. Locate the line and remember it.

- [ ] **Step 5.2: Add the new-appointment helpers and submit handler**

Insert this block immediately **before** `function openSelfComplete(id)`:

```js
    // ─── Новая запись (master self-booking) ──────────────────────
    function showNewApptCard() {
      const card = $('newApptCard');
      if (!card) return;
      card.style.display = session ? '' : 'none';
      if (!session) return;

      // Populate the service select from masterServices.
      const sel = $('mApptService');
      sel.innerHTML = '<option value="">Выберите услугу…</option>' +
        state.masterServices
          .map(ms => `<option value="${ms.service_id}" data-price="${ms.price}">${escapeHtml(ms.service_name)}</option>`)
          .join('');

      // Default datetime to next round hour, local time.
      const now = new Date();
      now.setMinutes(0, 0, 0);
      now.setHours(now.getHours() + 1);
      const pad = n => String(n).padStart(2, '0');
      const local = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
      $('mApptWhen').value = local;
      $('mApptWhen').min = local;
    }

    function onMApptServiceChange() {
      const sel = $('mApptService');
      const opt = sel.options[sel.selectedIndex];
      const price = opt ? Number(opt.dataset.price) : 0;
      if (price > 0) $('mApptPrice').value = price;
    }

    async function submitNewAppointment() {
      if (!session) return;
      const when = $('mApptWhen').value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return toast('Укажите дату и время', true);
      const serviceId = parseInt($('mApptService').value);
      if (!serviceId) return toast('Выберите услугу', true);
      const priceRaw = $('mApptPrice').value;
      const estimatedPrice = priceRaw === '' ? null : Number(priceRaw);
      if (estimatedPrice !== null && (!Number.isFinite(estimatedPrice) || estimatedPrice < 0)) {
        return toast('Цена некорректна', true);
      }
      const clientName = $('mApptClient').value.trim() || null;
      const clientPhone = $('mApptPhone').value.trim() || null;
      const note = $('mApptNote').value.trim() || null;

      try {
        const r = await fetch('/api/appointment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            master_id: session.masterId,
            pin: session.pin,
            scheduled_at_local: when,
            service_id: serviceId,
            estimated_price: estimatedPrice,
            client_name: clientName,
            client_phone: clientPhone,
            note,
          }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 409) return toast('Слот уже занят', true);
        if (r.status === 401) { toast('Неверный PIN, войдите снова', true); logout(); return; }
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        toast('Запись создана');
        // Clear inputs (keep datetime so the user can book another nearby slot).
        $('mApptClient').value = '';
        $('mApptPhone').value = '';
        $('mApptNote').value = '';
        await loadUpcoming();
      } catch (e) {
        toast('Ошибка: ' + (e.message || e), true);
      }
    }
```

- [ ] **Step 5.3: Call `showNewApptCard()` from `showEntryUI` and hide it from `showLoginUI`**

In `showEntryUI` (`register.html` ~line 1184), find this block:

```js
      try {
        await loadServicesForMaster(session.masterId);
        await loadUpcoming();
        await loadTodayAttendances();
      } catch (e) {
```

Add a call to `showNewApptCard()` right after `loadTodayAttendances()`:

```js
      try {
        await loadServicesForMaster(session.masterId);
        await loadUpcoming();
        await loadTodayAttendances();
        showNewApptCard();
      } catch (e) {
```

In `showLoginUI` (~line 1173), find the block that hides every card on logout:

```js
      $('loginCard').style.display = '';
      $('entryCard').style.display = 'none';
      $('todayCard').style.display = 'none';
      $('upcomingCard').style.display = 'none';
      $('historyCard').style.display = 'none';
```

Add the new card to the hide list:

```js
      $('loginCard').style.display = '';
      $('entryCard').style.display = 'none';
      $('todayCard').style.display = 'none';
      $('newApptCard').style.display = 'none';
      $('upcomingCard').style.display = 'none';
      $('historyCard').style.display = 'none';
```

- [ ] **Step 5.4: Smoke-test in browser**

1. Open http://localhost:3000/register, log in as `Тест Мастер` / `1234`.
2. Expand "Новая запись", pick tomorrow at any free hour, select "Тест Услуга", click "Создать".
3. Toast "Запись создана" appears; the new row shows up in "Мои записи".
4. Try to create again at the same datetime → toast "Слот уже занят".

If anything fails: check browser console for JS errors, or run the curl reproductions from Task 2 to isolate backend vs frontend.

- [ ] **Step 5.5: Cleanup + commit**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "delete from appointments where created_by like 'master:%' and client_name is null and client_phone is null;"

git add register.html
git commit -m "$(cat <<'EOF'
feat(schedule): pro /register — submit handler for Новая запись

Wires master self-booking via POST /api/appointment with master_id+pin.
Auto-fills price from master_services on service change.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Frontend — Cancel button on "Мои записи"

Add `[Отмена]` next to existing `[Выполнено]` in each upcoming row.

**Files:**
- Modify: `register.html` — `renderUpcoming` and add `cancelUpcoming` handler.

- [ ] **Step 6.1: Update `renderUpcoming` to include the cancel button**

Find `renderUpcoming` (around line 887). Inside the `<small>` block that holds the "Выполнено" button (around line 904), change:

```html
<div class="att-amt">${priceStr}<small><button type="button" class="btn-chip" style="margin-top:4px;" onclick="openSelfComplete(${a.id})">Выполнено</button></small></div>
```

Replace with:

```html
<div class="att-amt">${priceStr}<small style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;margin-top:4px;">
  <button type="button" class="btn-chip" onclick="openSelfComplete(${a.id})">Выполнено</button>
  <button type="button" class="btn-chip" onclick="cancelUpcoming(${a.id})">Отмена</button>
</small></div>
```

- [ ] **Step 6.2: Add the `cancelUpcoming` handler**

Insert right after `submitSelfComplete` function:

```js
    async function cancelUpcoming(id) {
      if (!session) return;
      if (!confirm('Отменить запись?')) return;
      try {
        const r = await fetch('/api/appointment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ master_id: session.masterId, pin: session.pin, id, status: 'cancelled' }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 409) return toast(data.error === 'Cannot edit terminal appointment' ? 'Запись уже завершена или отменена' : 'Конфликт', true);
        if (r.status === 401) { toast('Неверный PIN, войдите снова', true); logout(); return; }
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        toast('Запись отменена');
        await loadUpcoming();
      } catch (e) {
        toast('Ошибка: ' + (e.message || e), true);
      }
    }
```

- [ ] **Step 6.3: Smoke-test in browser**

1. /register, login as master 1.
2. Create a fresh appointment via "Новая запись".
3. In "Мои записи", click `[Отмена]` on that row → confirm dialog → row disappears (filtered out by `loadUpcoming`'s `.in('status', …)` clause).

- [ ] **Step 6.4: Commit**

```bash
git add register.html
git commit -m "$(cat <<'EOF'
feat(schedule): pro /register — cancel button on Мои записи

Master self-cancel via PATCH /api/appointment with status=cancelled.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Frontend — Reschedule (Перенести) inline form

Add `[Перенести]` button + inline datetime picker per row.

**Files:**
- Modify: `register.html` — `renderUpcoming` template + `openReschedule` / `closeReschedule` / `submitReschedule` handlers.

- [ ] **Step 7.1: Update `renderUpcoming` row template**

In `renderUpcoming` (the function modified in Task 6), update the `<small>` block to include a third button:

```html
<small style="display:flex;flex-direction:column;gap:4px;align-items:flex-end;margin-top:4px;">
  <button type="button" class="btn-chip" onclick="openSelfComplete(${a.id})">Выполнено</button>
  <button type="button" class="btn-chip" onclick="openReschedule(${a.id})">Перенести</button>
  <button type="button" class="btn-chip" onclick="cancelUpcoming(${a.id})">Отмена</button>
</small>
```

Then, inside the same `<li>`, after the `selfComplete-${a.id}` div (the existing self-complete inline form), add a new sibling div:

```html
          <div id="reschedule-${a.id}" class="self-complete-form" style="display:none;flex-basis:100%;background:#f3e8ee;border-radius:8px;padding:10px 12px;margin-top:6px;">
            <div class="row">
              <div>
                <label class="lbl">Новые дата и время</label>
                <input class="fld" type="datetime-local" id="reschWhen-${a.id}">
              </div>
            </div>
            <div style="margin-top:8px;display:flex;gap:8px;">
              <button class="btn" type="button" onclick="submitReschedule(${a.id})">Сохранить</button>
              <button class="btn" type="button" style="background:#eee;color:var(--ink);" onclick="closeReschedule(${a.id})">Отмена</button>
            </div>
          </div>
```

- [ ] **Step 7.2: Add the three handlers**

Insert right after `cancelUpcoming` (added in Task 6):

```js
    function openReschedule(id) {
      const el = $('reschedule-' + id);
      if (!el) return;
      // Pre-fill with the current scheduled_at converted to a datetime-local value.
      const a = state.upcoming.find(x => x.id === id);
      if (a) {
        const d = new Date(a.scheduled_at);
        const pad = n => String(n).padStart(2, '0');
        const local = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
        $('reschWhen-' + id).value = local;
      }
      el.style.display = '';
    }

    function closeReschedule(id) {
      const el = $('reschedule-' + id);
      if (el) el.style.display = 'none';
    }

    async function submitReschedule(id) {
      if (!session) return;
      const when = $('reschWhen-' + id).value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(when)) return toast('Укажите дату и время', true);
      try {
        const r = await fetch('/api/appointment', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ master_id: session.masterId, pin: session.pin, id, scheduled_at_local: when }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 409) {
          if (data.error === 'Cannot edit terminal appointment') return toast('Запись уже завершена или отменена', true);
          return toast('Слот уже занят', true);
        }
        if (r.status === 401) { toast('Неверный PIN, войдите снова', true); logout(); return; }
        if (!r.ok) throw new Error(data.error || ('HTTP ' + r.status));
        toast('Запись перенесена');
        closeReschedule(id);
        await loadUpcoming();
      } catch (e) {
        toast('Ошибка: ' + (e.message || e), true);
      }
    }
```

- [ ] **Step 7.3: Smoke-test in browser**

1. /register, login as master 1.
2. Create fresh appointment.
3. Click `[Перенести]` → datetime picker prefilled with current slot → change to a free slot → "Сохранить" → toast "Запись перенесена" → row updated in place.
4. Click `[Перенести]` again → change to a slot already occupied (create one in admin first) → toast "Слот уже занят", form stays open.

- [ ] **Step 7.4: Commit**

```bash
git add register.html
git commit -m "$(cat <<'EOF'
feat(schedule): pro /register — reschedule inline form on Мои записи

Adds Перенести button + datetime picker. PATCH with scheduled_at_local
moves the appointment in place; 409 conflict surfaces as toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Final E2E walk + cleanup + push

Walk the 9-item verification checklist from the spec, clean up test data, run final syntax checks. Do NOT push or deploy without explicit user approval.

- [ ] **Step 8.1: Reset PINs to test values (in case earlier tasks reset them)**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
UPDATE masters SET pin_hash='bcfe8e2013f1f297d00b8c844e7133a3:1a10a742781d7461c72731606f4393e50e18d4325c056650d572962b904a692e5f9a654ae1ad2836295e8aa31295afe62ff3ae13f6c6924f0f1d69d33994f1cd' WHERE id=1;
INSERT INTO masters (name, specialty, active, pin_hash) VALUES ('Тест Мастер 2', 'colorist', true, 'adc6ea63b6e05693c581a1763a787d54:575df0dfb41f5c0089b6207fadcc6364e68ba617ddcce19b76f8cf0e76eaceba7aa5285c99a7508657141c57e0472b68f714caf8628ac1dcaded8aba61ae7c61')
ON CONFLICT (name) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, active=true;
SQL
```

- [ ] **Step 8.2: Walk the 9-item spec checklist**

Use the spec checklist verbatim. Mark each ✅/❌:

1. **Master create own** — /register login as master 1 → form → "Создать" → row in "Мои записи".
2. **Admin sees it** — admin Агенда tab → row visible; psql confirms `created_by = 'master:1'`:
   ```bash
   psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select id, master_id, status, created_by from appointments where created_by like 'master:%';"
   ```
3. **Conflict on create** — same slot a second time → toast "Слот уже занят".
4. **Master reschedule** — `[Перенести]` → new datetime → save → row updates in place (id unchanged, `scheduled_at` changed).
5. **Reschedule conflict** — try to move onto another occupied slot → 409, form stays open.
6. **Master cancel** — `[Отмена]` → confirm → row disappears; `psql ... where status='cancelled' and id=<id>` confirms.
7. **Cross-master block (curl)** —
   ```bash
   # ID = an appointment of master 1
   curl -s -o /tmp/r.json -w "HTTP %{http_code}\n" -X PATCH 'http://localhost:3000/api/appointment' \
     -H 'Content-Type: application/json' \
     -d '{"master_id":2,"pin":"5678","id":<ID>,"status":"cancelled"}'
   cat /tmp/r.json
   ```
   Expected: HTTP 403 / `This appointment belongs to another master`.
8. **Terminal-edit block** — admin completes one row; master tries `[Перенести]` on it → toast "Запись уже завершена или отменена".
9. **Telegram (optional)** — only smoke-tested with token unset (no-ops). With `TELEGRAM_BOT_TOKEN` exported, repeat steps 1, 4, 6 → expect 📅, 🔁, ❌ messages.

- [ ] **Step 8.3: Final cleanup**

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres <<'SQL'
DELETE FROM attendances WHERE source='appointment';
DELETE FROM appointments;
DELETE FROM masters WHERE name='Тест Мастер 2';
UPDATE masters SET pin_hash=NULL WHERE id=1;
SELECT 'appointments' as t, count(*) FROM appointments
UNION ALL SELECT 'attendances appointment', count(*) FROM attendances WHERE source='appointment'
UNION ALL SELECT 'masters', count(*) FROM masters
UNION ALL SELECT 'master 1 has pin', count(*) FROM masters WHERE id=1 AND pin_hash IS NOT NULL;
SQL
```
Expected: all four counts = 0 except `masters` = 1.

- [ ] **Step 8.4: Final syntax checks**

```bash
node --check api/appointment.js && echo "api/appointment.js OK"
python3 -c "import re; html=open('register.html').read(); blocks=re.findall(r'<script>(.*?)</script>', html, re.S); print(blocks[-1])" | node --check - && echo "register.html last <script> OK"
python3 -c "import re; html=open('index.html').read(); blocks=re.findall(r'<script>(.*?)</script>', html, re.S); print(blocks[-1])" | node --check - && echo "index.html last <script> OK"
```
Expected: all three exit 0.

- [ ] **Step 8.5: Stop here. Ask the user before push or deploy.**

The plan ends with verification. **Do NOT** run `git push` — wait for explicit user approval. Report all 9 checklist items with ✅/❌ and evidence (curl outputs, screenshots if needed).

---

## Self-review summary

Spec coverage check (against [the design doc](../specs/2026-04-26-appointments-master-self-service-design.md)):

| Spec requirement | Covered by |
|---|---|
| POST master+pin already supported | Task 5 (frontend wiring only, since backend is unchanged) |
| `created_by = 'master:<id>'` recorded | Pre-existing; verified at Step 8.2 item 2 |
| PATCH `authorize()` swap | Task 1 (Step 1.1) |
| PATCH XOR `status` / `scheduled_at_local` | Task 1 (Step 1.7) |
| PATCH master cancel only | Task 1 (Step 1.6) |
| PATCH cross-master 403 | Task 1 (Step 1.5) |
| PATCH terminal-edit 409 | Task 2 (Step 2.6) |
| PATCH reschedule conflict 409 | Task 2 (Step 2.4) |
| Telegram on cancel | Task 3 (Step 3.1) |
| Telegram on reschedule | Task 3 (Step 3.2) |
| /register Новая запись card | Tasks 4 + 5 |
| /register Cancel button | Task 6 |
| /register Перенести button + form | Task 7 |
| 9 verification items | Task 8 |

| Verification item | Plan task |
|---|---|
| 1. Master create own | Task 5 (Step 5.4) + Task 8 (Step 8.2 #1) |
| 2. Admin sees it | Task 8 (Step 8.2 #2) |
| 3. Conflict on create | Task 5 (Step 5.4) + Task 8 (#3) |
| 4. Master reschedule | Task 7 (Step 7.3) + Task 8 (#4) |
| 5. Reschedule conflict | Task 7 (Step 7.3) + Task 8 (#5) |
| 6. Master cancel | Task 6 (Step 6.3) + Task 8 (#6) |
| 7. Cross-master block | Task 1 (Step 1.5) + Task 8 (#7) |
| 8. Terminal-edit block | Task 2 (Step 2.6) + Task 8 (#8) |
| 9. Telegram | Task 3 (Step 3.5) + Task 8 (#9) |

No placeholders, no TBDs, no "implement later". All curl/psql snippets are runnable as-is (substituting captured `<ID>` values where indicated).
