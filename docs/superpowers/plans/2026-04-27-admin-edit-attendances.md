# Admin Edit/Delete/Retro Attendances — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the salon administrator edit, soft-delete, restore, and retroactively create attendance records in the admin panel, with a full audit trail and Telegram notifications, while preventing masters from silently altering their own logged services.

**Architecture:** New Vercel serverless endpoints (`/api/admin-session`, `/api/admin-attendance`, `/api/admin-audit`) following the same pattern as existing `api/attendance.js` and `api/appointment.js`. Soft delete via `deleted_at` column. Audit trail in new `attendance_audit` table with full JSON snapshots. Admin re-auth gated by an HMAC-signed cookie ("edit mode") valid for 15 min. Single HTML panel file gets new modals, inline action buttons, and a new "Журнал правок" tab.

**Tech Stack:** Vercel serverless (Node 18, CommonJS), Supabase Postgres + REST (service role for writes), vanilla HTML/CSS/JS in panel (no build step), Supabase JS client (already loaded via CDN), Telegram Bot API.

**Spec:** `docs/superpowers/specs/2026-04-27-admin-edit-attendances-design.md`

**Note on testing:** Repo has no test framework. Each task includes manual verification steps (curl + Supabase query + browser check). Set up local env per `README.md` (Vercel CLI + `vercel dev`).

---

## Task 1: Database migration

**Files:**
- Create: `supabase/migrations/005_attendance_audit.sql`

- [ ] **Step 1: Write the migration SQL**

Create `supabase/migrations/005_attendance_audit.sql`:

```sql
-- 005_attendance_audit.sql
-- Soft delete + edit timestamp on attendances; new audit table for admin actions.

alter table attendances
  add column if not exists deleted_at timestamptz,
  add column if not exists edited_at  timestamptz;

create index if not exists attendances_deleted_at_idx on attendances (deleted_at);

create table if not exists attendance_audit (
  id            bigserial primary key,
  attendance_id bigint not null,
  action        text   not null check (action in ('create_retro','update','delete','restore')),
  actor         text   not null default 'admin',
  actor_ip      text,
  before        jsonb,
  after         jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists attendance_audit_att_idx     on attendance_audit (attendance_id);
create index if not exists attendance_audit_created_idx on attendance_audit (created_at desc);

alter table attendance_audit enable row level security;
-- No anon/authenticated policies => default deny. Only service-role reads/writes.
```

- [ ] **Step 2: Apply locally and verify**

Run:
```bash
supabase db push
```
Expected: migration applied. Verify in Supabase dashboard or with:
```bash
supabase db reset --linked --debug    # only if you want a clean reset; otherwise just push
```

Verification query (Supabase SQL editor or `psql`):
```sql
\d attendances
\d attendance_audit
select column_name from information_schema.columns
  where table_name='attendances' and column_name in ('deleted_at','edited_at');
-- expect 2 rows
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/005_attendance_audit.sql
git commit -m "feat(db): soft-delete + audit table for attendances"
```

---

## Task 2: Filter deleted attendances from existing reads

**Files:**
- Modify: `Nicole_Beauty_Панель.html` (the `loadAttendancesForMonth` function near line 340)
- Modify: `register.html` (any select from `attendances` for personal history)
- Modify: `report.html` (any select from `attendances`)

- [ ] **Step 1: Find every read of attendances**

Run:
```bash
grep -n "from('attendances')" Nicole_Beauty_Панель.html register.html report.html api/*.js
```
Expected: a small list. The api endpoints write only — do not change them. For each `.from('attendances').select(...)` in the three HTML files, you will append `.is('deleted_at', null)`.

- [ ] **Step 2: Patch `Nicole_Beauty_Панель.html`**

In `loadAttendancesForMonth(month)` (around line 340-352), change the query chain:

```js
// before
.from('attendances')
.select('id, date, time, master_id, service_id, service_name, price, master_pay, commission_pct, uses_salon_products, client_name, payment_method, source, note')
.gte('date', from).lte('date', to)
.order('date', { ascending: true });

// after — add .is('deleted_at', null) and also pull deleted_at + edited_at for the audit toggle
.from('attendances')
.select('id, date, time, master_id, service_id, service_name, price, master_pay, commission_pct, uses_salon_products, client_name, payment_method, source, note, deleted_at, edited_at')
.gte('date', from).lte('date', to)
.is('deleted_at', null)
.order('date', { ascending: true });
```

(Adjust the exact `select(...)` arg list to match what's currently there — keep all existing columns, add `deleted_at, edited_at` and the `.is('deleted_at', null)` filter.)

- [ ] **Step 3: Patch `register.html` and `report.html` similarly**

For every `from('attendances').select(...)` in these files, add `.is('deleted_at', null)` to the chain (no need to add `deleted_at` to the select list — the master/report views never show deleted rows).

- [ ] **Step 4: Manual smoke test**

Run `vercel dev`. In Supabase SQL editor, manually soft-delete one attendance:
```sql
update attendances set deleted_at = now() where id = (select id from attendances order by id desc limit 1) returning id, date, master_id;
```
Reload the panel's Финансы tab for that month — the row should be gone. Reload `register.html` → log in as that master → personal history should not show it. Restore:
```sql
update attendances set deleted_at = null where id = <the id from above>;
```

- [ ] **Step 5: Commit**

```bash
git add Nicole_Beauty_Панель.html register.html report.html
git commit -m "feat: filter soft-deleted attendances from all reads"
```

---

## Task 3: Shared admin-session helper module

**Files:**
- Create: `api/_lib/admin-session.js`

- [ ] **Step 1: Create the helper**

Vercel serverless treats `api/_lib/` as non-routed (underscore prefix). Create `api/_lib/admin-session.js`:

```js
// Shared HMAC-signed admin session cookie helpers.
// Cookie name: ns_admin (Nicole salon admin).
// Payload: base64url JSON { exp: <unix-seconds> }.
// Signed with HMAC-SHA256 using ADMIN_SESSION_SECRET (env).

const { createHmac, timingSafeEqual } = require('crypto');

const COOKIE_NAME = 'ns_admin';
const TTL_SECONDS = 15 * 60;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('ADMIN_SESSION_SECRET not set or too short (>=16 chars)');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadB64) {
  return b64url(createHmac('sha256', secret()).update(payloadB64).digest());
}

function makeToken(ttlSeconds = TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ exp }));
  const sig = sign(payload);
  return { token: `${payload}.${sig}`, exp };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed;
  try { parsed = JSON.parse(b64urlDecode(payload).toString('utf8')); } catch { return null; }
  if (!parsed?.exp || Date.now() / 1000 > parsed.exp) return null;
  return parsed;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(/;\s*/).forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function setCookie(res, token) {
  const isProd = process.env.VERCEL_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${TTL_SECONDS}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Returns true if request carries a valid session cookie.
function hasValidSession(req) {
  const cookies = parseCookies(req);
  return !!verifyToken(cookies[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  TTL_SECONDS,
  makeToken,
  verifyToken,
  parseCookies,
  setCookie,
  clearCookie,
  hasValidSession,
};
```

- [ ] **Step 2: Add env var locally**

Add `ADMIN_SESSION_SECRET=<random 32+ char hex>` to `.env.local` (or `vercel env add ADMIN_SESSION_SECRET` for production later). Generate one:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- [ ] **Step 3: Commit**

```bash
git add api/_lib/admin-session.js
git commit -m "feat(api): admin-session HMAC cookie helper"
```

---

## Task 4: POST /api/admin-session endpoint

**Files:**
- Create: `api/admin-session.js`

- [ ] **Step 1: Implement endpoint**

```js
// Vercel serverless — unlock admin "edit mode".
// POST /api/admin-session         → body { admin_password } → sets ns_admin cookie 15min
// POST /api/admin-session?end=1   → clears the cookie (lock now)

const { timingSafeEqual } = require('crypto');
const { makeToken, setCookie, clearCookie } = require('./_lib/admin-session');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  if (req.query?.end === '1' || req.url?.includes('end=1')) {
    clearCookie(res);
    return json(res, 200, { ok: true, locked: true });
  }

  if (!ADMIN_PASSWORD) return json(res, 500, { error: 'ADMIN_PASSWORD not set' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const pw = String(body.admin_password || '');
  if (!pw) return json(res, 400, { error: 'admin_password required' });

  if (!constantTimeEqualStr(pw, ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 400));
    return json(res, 401, { error: 'Неверный пароль' });
  }

  let token, exp;
  try { ({ token, exp } = makeToken()); }
  catch (e) { return json(res, 500, { error: e.message }); }

  setCookie(res, token);
  return json(res, 200, { ok: true, expires_at: exp });
};
```

- [ ] **Step 2: Manual verification**

```bash
vercel dev   # in another terminal
# wrong password
curl -i -X POST http://localhost:3000/api/admin-session \
  -H 'content-type: application/json' \
  -d '{"admin_password":"wrong"}'
# expect HTTP/1.1 401

# correct password (use whatever your local ADMIN_PASSWORD is)
curl -i -X POST http://localhost:3000/api/admin-session \
  -H 'content-type: application/json' \
  -d '{"admin_password":"<your-admin-password>"}'
# expect HTTP/1.1 200, Set-Cookie: ns_admin=...; HttpOnly; ...

# end session
curl -i -X POST 'http://localhost:3000/api/admin-session?end=1'
# expect Set-Cookie clearing ns_admin
```

- [ ] **Step 3: Commit**

```bash
git add api/admin-session.js
git commit -m "feat(api): /api/admin-session unlock + lock endpoint"
```

---

## Task 5: /api/admin-attendance — scaffolding + auth

**Files:**
- Create: `api/admin-attendance.js`

- [ ] **Step 1: Implement skeleton with auth + dispatcher**

```js
// Vercel serverless — admin CRUD over attendances.
// POST /api/admin-attendance
// Body: { action: 'create'|'update'|'delete'|'restore', id?, fields?, reason?, admin_password? }
// Auth: ns_admin cookie OR admin_password in body. Successful call refreshes cookie.

const { timingSafeEqual } = require('crypto');
const { hasValidSession, makeToken, setCookie } = require('./_lib/admin-session');

const SUPABASE_URL    = process.env.SUPABASE_URL;
const SERVICE_ROLE    = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD;

const MAX_PRICE_MULTIPLIER = 10;

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function sb(method, path, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': 'Bearer ' + SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' || method === 'PATCH' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
}

function escMd(s) { return String(s || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'); }

function json(res, code, obj) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = code;
  res.end(JSON.stringify(obj));
}

async function authorize(req, body) {
  if (hasValidSession(req)) return true;
  const pw = String(body.admin_password || '');
  if (!pw) return false;
  if (!ADMIN_PASSWORD || !constantTimeEqualStr(pw, ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 400));
    return false;
  }
  return true;
}

function refreshSession(res) {
  try { const { token } = makeToken(); setCookie(res, token); } catch {}
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const ok = await authorize(req, body);
  if (!ok) return json(res, 401, { error: 'Unauthorized' });

  const action = String(body.action || '');
  const ip     = clientIp(req);
  const reason = (body.reason || '').toString().slice(0, 500) || null;

  try {
    let result;
    switch (action) {
      case 'create':  result = await handleCreate(body, ip, reason);  break;
      case 'update':  result = await handleUpdate(body, ip, reason);  break;
      case 'delete':  result = await handleDelete(body, ip, reason);  break;
      case 'restore': result = await handleRestore(body, ip, reason); break;
      default: return json(res, 400, { error: 'Unknown action' });
    }
    refreshSession(res);
    return json(res, 200, { ok: true, ...result });
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error('admin-attendance error:', e);
    return json(res, 500, { error: e.message || String(e) });
  }
};

// Handlers added in next tasks
async function handleCreate(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleUpdate(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleDelete(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleRestore(body, ip, reason) { throw Object.assign(new Error('not implemented'), { status: 501 }); }

// Exposed for next tasks via module reuse — also export helpers
module.exports.sb = sb;
module.exports.escMd = escMd;
```

- [ ] **Step 2: Verify auth works**

```bash
# no auth at all → 401
curl -s -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' -d '{"action":"create"}'
# expect {"error":"Unauthorized"}

# with admin_password in body → reaches dispatcher, hits 501
curl -s -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"create","admin_password":"<your-admin-password>"}'
# expect {"error":"not implemented"}

# unlock + reuse cookie
curl -s -c cookies.txt -X POST http://localhost:3000/api/admin-session \
  -H 'content-type: application/json' \
  -d '{"admin_password":"<your-admin-password>"}'
curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' -d '{"action":"create"}'
# expect {"error":"not implemented"} — i.e. auth passed via cookie
```

- [ ] **Step 3: Commit**

```bash
git add api/admin-attendance.js
git commit -m "feat(api): admin-attendance scaffold + auth"
```

---

## Task 6: handleCreate — retroactive attendance

**Files:**
- Modify: `api/admin-attendance.js` (replace `handleCreate` stub)

- [ ] **Step 1: Add a Telegram helper inside the file**

Add this near the top-level helpers (above the `module.exports = async (req, res)` block):

```js
async function notifyTelegram(title, lines) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const text = [title, '', ...lines].filter(Boolean).join('\n');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }),
      signal: ctrl.signal,
    });
    if (!r.ok) console.error('telegram non-OK:', r.status, (await r.text()).slice(0, 300));
  } catch (e) { console.error('telegram failed:', e?.message || e); }
  finally { clearTimeout(timer); }
}

// Compute master_pay + commission_pct server-side from master_services.
// Returns { master_pay, commission_pct, service_name, master_name } or throws { status }.
async function computePay({ master_id, service_id, price, uses_salon_products }) {
  const ms = await sb('GET', `master_services?select=price,commission_master_pct,commission_master_pct_salon,services(name),masters(name)&master_id=eq.${master_id}&service_id=eq.${service_id}&limit=1`);
  const row = Array.isArray(ms) ? ms[0] : null;
  if (!row) { const e = new Error('Service not configured for this master'); e.status = 422; throw e; }
  const catalogPrice = Number(row.price) || 0;
  const pct = uses_salon_products ? Number(row.commission_master_pct_salon) : Number(row.commission_master_pct);
  if (!Number.isFinite(pct)) { const e = new Error('Commission rate missing'); e.status = 422; throw e; }
  if (catalogPrice > 0 && price > catalogPrice * MAX_PRICE_MULTIPLIER) {
    const e = new Error(`Price exceeds allowed range (max ${catalogPrice * MAX_PRICE_MULTIPLIER})`); e.status = 422; throw e;
  }
  return {
    master_pay: Math.round(price * pct) / 100,
    commission_pct: pct,
    service_name: row.services?.name || null,
    master_name:  row.masters?.name  || null,
  };
}

function validateFields(f) {
  const errs = [];
  if (!f) errs.push('fields required');
  else {
    if (!f.master_id)  errs.push('master_id required');
    if (!f.service_id) errs.push('service_id required');
    if (!(Number(f.price) > 0)) errs.push('price must be > 0');
    if (f.date && !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) errs.push('date must be YYYY-MM-DD');
    if (f.time && !/^\d{2}:\d{2}(:\d{2})?$/.test(f.time)) errs.push('time must be HH:MM[:SS]');
  }
  if (errs.length) { const e = new Error(errs.join('; ')); e.status = 400; throw e; }
}

function nowDateTimeParts() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  };
}
```

- [ ] **Step 2: Replace `handleCreate` stub with real implementation**

```js
async function handleCreate(body, ip, reason) {
  const f = body.fields || {};
  validateFields(f);

  const masterId = parseInt(f.master_id);
  const serviceId = parseInt(f.service_id);
  const price = Number(f.price);
  const usesSalon = f.uses_salon_products === true;

  const pay = await computePay({
    master_id: masterId, service_id: serviceId, price, uses_salon_products: usesSalon,
  });

  const dt = nowDateTimeParts();
  const date = f.date || dt.date;
  const time = f.time || dt.time;

  const inserted = await sb('POST', 'attendances', {
    date, time,
    master_id: masterId,
    service_id: serviceId,
    service_name: pay.service_name,
    price,
    master_pay: pay.master_pay,
    commission_pct: pay.commission_pct,
    uses_salon_products: usesSalon,
    client_name: (f.client_name || '').toString().slice(0, 200) || null,
    payment_method: (f.payment_method || '').toString().slice(0, 40) || null,
    note: (f.note || '').toString().slice(0, 500) || null,
    source: 'admin_retro',
  });
  const row = Array.isArray(inserted) ? inserted[0] : inserted;

  await sb('POST', 'attendance_audit', {
    attendance_id: row.id,
    action: 'create_retro',
    actor: 'admin',
    actor_ip: ip,
    before: null,
    after: row,
    reason,
  });

  await notifyTelegram('➕ *Ретро\\-запись*', [
    `*Мастер:* ${escMd(pay.master_name)}`,
    `*Услуга:* ${escMd(pay.service_name) || '—'}`,
    `*Цена:* ${price.toLocaleString('ru-RU')} ₽`,
    `*Мастеру:* ${pay.master_pay.toLocaleString('ru-RU')} ₽ (${pay.commission_pct}%)`,
    `_${time.slice(0,5)} · ${date}_`,
    reason ? `*Причина:* ${escMd(reason)}` : null,
  ]);

  return { id: row.id, master_pay: pay.master_pay, commission_pct: pay.commission_pct };
}
```

- [ ] **Step 3: Verify**

```bash
# Pick existing master_id and service_id from your DB:
# select m.id master_id, s.id service_id, ms.price from master_services ms join masters m on m.id=ms.master_id join services s on s.id=ms.service_id limit 5;

curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"create","reason":"retro test","fields":{"master_id":1,"service_id":1,"price":1500,"uses_salon_products":false,"client_name":"Test","date":"2026-04-25","time":"10:00:00"}}'
# expect { "ok":true,"id":<n>,"master_pay":...,"commission_pct":... }
```
Verify in Supabase:
```sql
select id, source, date, time, price, master_pay from attendances order by id desc limit 1;
select action, actor, before, after, reason from attendance_audit order by id desc limit 1;
```
And confirm a Telegram message arrived (if env vars are set locally).

- [ ] **Step 4: Commit**

```bash
git add api/admin-attendance.js
git commit -m "feat(api): retro attendance creation with audit + telegram"
```

---

## Task 7: handleUpdate — edit attendance

**Files:**
- Modify: `api/admin-attendance.js` (replace `handleUpdate` stub)

- [ ] **Step 1: Implement**

```js
async function handleUpdate(body, ip, reason) {
  const id = parseInt(body.id);
  if (!id) { const e = new Error('id required'); e.status = 400; throw e; }
  const f = body.fields || {};
  validateFields(f);

  const cur = await sb('GET', `attendances?select=*&id=eq.${id}&limit=1`);
  const before = Array.isArray(cur) ? cur[0] : null;
  if (!before) { const e = new Error('Attendance not found'); e.status = 404; throw e; }
  if (before.deleted_at) { const e = new Error('Cannot edit a deleted record. Restore it first.'); e.status = 409; throw e; }

  const masterId  = parseInt(f.master_id);
  const serviceId = parseInt(f.service_id);
  const price     = Number(f.price);
  const usesSalon = f.uses_salon_products === true;

  const recompute =
    masterId  !== before.master_id  ||
    serviceId !== before.service_id ||
    Number(price) !== Number(before.price) ||
    Boolean(usesSalon) !== Boolean(before.uses_salon_products);

  let pay;
  if (recompute) {
    pay = await computePay({ master_id: masterId, service_id: serviceId, price, uses_salon_products: usesSalon });
  } else {
    // Still need service/master names if id is unchanged — derive from existing row.
    pay = {
      master_pay: Number(before.master_pay),
      commission_pct: Number(before.commission_pct),
      service_name: before.service_name,
      master_name: null, // looked up below for telegram if needed
    };
  }

  const patch = {
    date: f.date || before.date,
    time: f.time || before.time,
    master_id: masterId,
    service_id: serviceId,
    service_name: pay.service_name,
    price,
    master_pay: pay.master_pay,
    commission_pct: pay.commission_pct,
    uses_salon_products: usesSalon,
    client_name: (f.client_name || '').toString().slice(0, 200) || null,
    payment_method: (f.payment_method || '').toString().slice(0, 40) || null,
    note: (f.note || '').toString().slice(0, 500) || null,
    edited_at: new Date().toISOString(),
  };

  const updated = await sb('PATCH', `attendances?id=eq.${id}`, patch);
  const after = Array.isArray(updated) ? updated[0] : updated;

  await sb('POST', 'attendance_audit', {
    attendance_id: id, action: 'update', actor: 'admin', actor_ip: ip,
    before, after, reason,
  });

  // Diff summary for Telegram (only fields that actually changed).
  const watch = ['date','time','master_id','service_id','price','master_pay','commission_pct','uses_salon_products','client_name','payment_method','note'];
  const diffs = watch
    .filter(k => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(k => `${k}: ${escMd(String(before[k] ?? '—'))} → ${escMd(String(after[k] ?? '—'))}`);

  // Resolve master name for telegram header
  let masterName = pay.master_name;
  if (!masterName) {
    const m = await sb('GET', `masters?select=name&id=eq.${masterId}&limit=1`);
    masterName = (Array.isArray(m) ? m[0]?.name : null) || `id=${masterId}`;
  }

  await notifyTelegram('🛠️ *Админ\\-правка*', [
    `*Мастер:* ${escMd(masterName)}`,
    `*Запись:* id=${id}`,
    diffs.length ? '*Изменения:*' : '_без изменений_',
    ...diffs,
    reason ? `*Причина:* ${escMd(reason)}` : null,
  ]);

  return { id, master_pay: pay.master_pay, commission_pct: pay.commission_pct };
}
```

- [ ] **Step 2: Verify**

```bash
# pick an existing attendance id (NOT the deleted soft-test one)
curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"update","id":<id>,"reason":"price typo","fields":{"master_id":1,"service_id":1,"price":1700,"uses_salon_products":false,"client_name":"Test edited","date":"2026-04-25","time":"10:00:00"}}'
# expect ok:true with recomputed master_pay
```
SQL check:
```sql
select id, price, master_pay, edited_at from attendances where id=<id>;
select action, before->>'price' as old_price, after->>'price' as new_price, reason
  from attendance_audit where attendance_id=<id> order by id desc limit 1;
```

- [ ] **Step 3: Commit**

```bash
git add api/admin-attendance.js
git commit -m "feat(api): admin update attendance with recompute + audit"
```

---

## Task 8: handleDelete + handleRestore

**Files:**
- Modify: `api/admin-attendance.js` (replace both stubs)

- [ ] **Step 1: Implement both**

```js
async function handleDelete(body, ip, reason) {
  const id = parseInt(body.id);
  if (!id) { const e = new Error('id required'); e.status = 400; throw e; }

  const cur = await sb('GET', `attendances?select=*&id=eq.${id}&limit=1`);
  const before = Array.isArray(cur) ? cur[0] : null;
  if (!before) { const e = new Error('Attendance not found'); e.status = 404; throw e; }
  if (before.deleted_at) {
    return { id, already_deleted: true };  // idempotent
  }

  const updated = await sb('PATCH', `attendances?id=eq.${id}`, { deleted_at: new Date().toISOString() });
  const after = Array.isArray(updated) ? updated[0] : updated;

  await sb('POST', 'attendance_audit', {
    attendance_id: id, action: 'delete', actor: 'admin', actor_ip: ip,
    before, after: null, reason,
  });

  const m = await sb('GET', `masters?select=name&id=eq.${before.master_id}&limit=1`);
  const masterName = (Array.isArray(m) ? m[0]?.name : null) || `id=${before.master_id}`;

  await notifyTelegram('🗑️ *Админ\\-удаление*', [
    `*Мастер:* ${escMd(masterName)}`,
    `*Услуга:* ${escMd(before.service_name) || '—'}`,
    `*Цена:* ${Number(before.price).toLocaleString('ru-RU')} ₽`,
    `_${String(before.time || '').slice(0,5)} · ${before.date}_`,
    `*Запись:* id=${id}`,
    reason ? `*Причина:* ${escMd(reason)}` : null,
  ]);

  return { id, deleted_at: after.deleted_at };
}

async function handleRestore(body, ip, reason) {
  const id = parseInt(body.id);
  if (!id) { const e = new Error('id required'); e.status = 400; throw e; }

  const cur = await sb('GET', `attendances?select=*&id=eq.${id}&limit=1`);
  const before = Array.isArray(cur) ? cur[0] : null;
  if (!before) { const e = new Error('Attendance not found'); e.status = 404; throw e; }
  if (!before.deleted_at) { const e = new Error('Record is not deleted'); e.status = 409; throw e; }

  const updated = await sb('PATCH', `attendances?id=eq.${id}`, { deleted_at: null });
  const after = Array.isArray(updated) ? updated[0] : updated;

  await sb('POST', 'attendance_audit', {
    attendance_id: id, action: 'restore', actor: 'admin', actor_ip: ip,
    before, after, reason,
  });

  const m = await sb('GET', `masters?select=name&id=eq.${before.master_id}&limit=1`);
  const masterName = (Array.isArray(m) ? m[0]?.name : null) || `id=${before.master_id}`;

  await notifyTelegram('↩️ *Восстановление*', [
    `*Мастер:* ${escMd(masterName)}`,
    `*Запись:* id=${id}`,
    reason ? `*Причина:* ${escMd(reason)}` : null,
  ]);

  return { id };
}
```

- [ ] **Step 2: Verify**

```bash
# delete
curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"delete","id":<id>,"reason":"duplicado"}'
# expect ok:true, deleted_at set

# update on deleted → 409
curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"update","id":<id>,"fields":{"master_id":1,"service_id":1,"price":1500}}'
# expect 409

# restore
curl -s -b cookies.txt -X POST http://localhost:3000/api/admin-attendance \
  -H 'content-type: application/json' \
  -d '{"action":"restore","id":<id>}'
# expect ok:true

# delete already deleted → idempotent ok with already_deleted:true
```
SQL check:
```sql
select action, attendance_id, reason, created_at from attendance_audit
  order by id desc limit 5;
```

- [ ] **Step 3: Commit**

```bash
git add api/admin-attendance.js
git commit -m "feat(api): admin delete/restore attendance with audit + telegram"
```

---

## Task 9: GET /api/admin-audit endpoint

**Files:**
- Create: `api/admin-audit.js`

- [ ] **Step 1: Implement**

```js
// Vercel serverless — list audit entries for the admin panel "Журнал правок" tab.
// GET /api/admin-audit?from=YYYY-MM-DD&to=YYYY-MM-DD&master_id=&action=&limit=&offset=
// Auth: ns_admin cookie OR admin_password query param (last resort, not recommended).

const { hasValidSession, makeToken, setCookie } = require('./_lib/admin-session');
const { timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function sb(method, path, headers = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': 'Bearer ' + SERVICE_ROLE,
      'Accept': 'application/json',
      ...headers,
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0,400)}`);
  return { rows: text ? JSON.parse(text) : [], total: parseInt((r.headers.get('content-range') || '').split('/')[1]) || null };
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured' });

  const q = req.query || {};
  let authed = hasValidSession(req);
  if (!authed) {
    const pw = String(q.admin_password || '');
    if (pw && ADMIN_PASSWORD && constantTimeEqualStr(pw, ADMIN_PASSWORD)) authed = true;
  }
  if (!authed) return json(res, 401, { error: 'Unauthorized' });

  const filters = [];
  if (q.from)        filters.push(`created_at=gte.${encodeURIComponent(q.from + 'T00:00:00')}`);
  if (q.to)          filters.push(`created_at=lte.${encodeURIComponent(q.to   + 'T23:59:59')}`);
  if (q.action)      filters.push(`action=eq.${encodeURIComponent(q.action)}`);
  if (q.master_id) {
    // Filter by master_id captured in the snapshot. Use a JSONB ?? operator via PostgREST:
    // before->>master_id or after->>master_id matches.
    // PostgREST allows: or=(before->>master_id.eq.X,after->>master_id.eq.X)
    const mid = parseInt(q.master_id);
    filters.push(`or=(before->>master_id.eq.${mid},after->>master_id.eq.${mid})`);
  }
  if (q.attendance_id) filters.push(`attendance_id=eq.${parseInt(q.attendance_id)}`);

  const limit  = Math.min(parseInt(q.limit)  || 100, 500);
  const offset = Math.max(parseInt(q.offset) || 0, 0);

  const select = 'id,attendance_id,action,actor,actor_ip,before,after,reason,created_at';
  const path = `attendance_audit?select=${select}&order=created_at.desc&limit=${limit}&offset=${offset}` +
    (filters.length ? '&' + filters.join('&') : '');

  try {
    const { rows, total } = await sb('GET', path, { 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': `${offset}-${offset+limit-1}` });
    try { const { token } = makeToken(); setCookie(res, token); } catch {}
    return json(res, 200, { rows, total });
  } catch (e) {
    console.error('admin-audit error:', e);
    return json(res, 500, { error: e.message });
  }
};
```

- [ ] **Step 2: Verify**

```bash
curl -s -b cookies.txt 'http://localhost:3000/api/admin-audit?limit=10' | head -c 800
# expect { "rows": [...], "total": <n> }

curl -s -b cookies.txt 'http://localhost:3000/api/admin-audit?action=delete&limit=5'
# expect rows filtered to deletes
```

- [ ] **Step 3: Commit**

```bash
git add api/admin-audit.js
git commit -m "feat(api): /api/admin-audit list endpoint"
```

---

## Task 10: Panel — admin session unlock UI

**Files:**
- Modify: `Nicole_Beauty_Панель.html` (add a global "edit mode" state + unlock modal + indicator)

- [ ] **Step 1: Add the unlock modal HTML**

Find the `</body>` tag in `Nicole_Beauty_Панель.html`. Just before it, add:

```html
<!-- Admin edit-mode unlock modal -->
<div id="adminUnlockModal" class="ns-modal-backdrop" hidden>
  <div class="ns-modal">
    <h3>Режим правки</h3>
    <p class="ns-muted">Введите пароль администратора для разблокировки правок на 15 минут.</p>
    <input id="adminUnlockPwd" type="password" autocomplete="off" placeholder="Пароль" />
    <div id="adminUnlockErr" class="ns-err" hidden></div>
    <div class="ns-modal-actions">
      <button type="button" id="adminUnlockCancel">Отмена</button>
      <button type="button" id="adminUnlockOk" class="primary">Разблокировать</button>
    </div>
  </div>
</div>

<!-- Edit-mode indicator -->
<div id="adminEditBadge" class="ns-edit-badge" hidden>
  <span id="adminEditBadgeTxt">🔓 Режим правки активен</span>
  <button type="button" id="adminEditLockBtn" title="Заблокировать">🔒</button>
</div>
```

Add styles inside the existing `<style>` block (or appended at the end of it):

```css
.ns-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:1000}
.ns-modal{background:#fff;border-radius:12px;padding:20px;max-width:520px;width:92%;box-shadow:0 10px 40px rgba(0,0,0,.2)}
.ns-modal h3{margin:0 0 8px}
.ns-muted{color:#666;font-size:13px;margin:0 0 12px}
.ns-modal input,.ns-modal select,.ns-modal textarea{width:100%;padding:8px;border:1px solid #ccc;border-radius:6px;margin:4px 0;font-size:14px;box-sizing:border-box}
.ns-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}
.ns-modal-actions button{padding:8px 14px;border-radius:6px;border:1px solid #ccc;background:#f5f5f5;cursor:pointer}
.ns-modal-actions button.primary{background:#2563eb;color:#fff;border-color:#2563eb}
.ns-modal-actions button.danger{background:#dc2626;color:#fff;border-color:#dc2626}
.ns-err{color:#b91c1c;font-size:13px;margin:6px 0}
.ns-edit-badge{position:fixed;bottom:14px;right:14px;background:#fef3c7;border:1px solid #f59e0b;border-radius:20px;padding:6px 12px;display:flex;gap:8px;align-items:center;z-index:900;font-size:13px;box-shadow:0 4px 12px rgba(0,0,0,.1)}
.ns-edit-badge button{background:transparent;border:0;cursor:pointer;font-size:14px}
.ns-row-actions{display:inline-flex;gap:4px;margin-left:8px}
.ns-row-actions button{background:transparent;border:0;cursor:pointer;padding:2px 4px;font-size:14px;opacity:.6}
.ns-row-actions button:hover{opacity:1}
.ns-row-deleted{opacity:.45;text-decoration:line-through}
```

- [ ] **Step 2: Add the JS state + helper**

Find a good top-level place in the existing `<script>` block (e.g. near `data = { attendances: [], ... }`). Add:

```js
// ─── Admin edit-mode state ─────────────────────────────────────────
const adminEdit = {
  expiresAt: 0,             // unix seconds
  tickHandle: null,
  isUnlocked() { return Date.now() / 1000 < this.expiresAt; },
  unlock(expSeconds) {
    this.expiresAt = expSeconds || (Math.floor(Date.now()/1000) + 15*60);
    this._renderBadge();
    if (!this.tickHandle) this.tickHandle = setInterval(() => this._renderBadge(), 30 * 1000);
  },
  lock() {
    this.expiresAt = 0;
    if (this.tickHandle) { clearInterval(this.tickHandle); this.tickHandle = null; }
    this._renderBadge();
    fetch('/api/admin-session?end=1', { method: 'POST', credentials: 'same-origin' }).catch(()=>{});
  },
  _renderBadge() {
    const el = document.getElementById('adminEditBadge');
    if (!el) return;
    if (!this.isUnlocked()) { el.hidden = true; return; }
    el.hidden = false;
    const minsLeft = Math.max(0, Math.ceil((this.expiresAt - Date.now()/1000) / 60));
    document.getElementById('adminEditBadgeTxt').textContent = `🔓 Режим правки активен (осталось ${minsLeft} мин)`;
  },
};

// Returns a Promise<boolean>. Opens unlock modal if needed.
function ensureAdminEditMode() {
  if (adminEdit.isUnlocked()) return Promise.resolve(true);
  return new Promise(resolve => {
    const modal = document.getElementById('adminUnlockModal');
    const pwd   = document.getElementById('adminUnlockPwd');
    const err   = document.getElementById('adminUnlockErr');
    const ok    = document.getElementById('adminUnlockOk');
    const cancel= document.getElementById('adminUnlockCancel');
    pwd.value = ''; err.hidden = true; modal.hidden = false; setTimeout(()=>pwd.focus(), 30);

    const close = (result) => {
      modal.hidden = true;
      ok.onclick = null; cancel.onclick = null; pwd.onkeydown = null;
      resolve(result);
    };
    ok.onclick = async () => {
      ok.disabled = true;
      try {
        const r = await fetch('/api/admin-session', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_password: pwd.value }),
        });
        const j = await r.json().catch(()=>({}));
        if (!r.ok) { err.textContent = j.error || 'Ошибка'; err.hidden = false; ok.disabled = false; return; }
        adminEdit.unlock(j.expires_at);
        close(true);
      } catch (e) { err.textContent = String(e.message || e); err.hidden = false; ok.disabled = false; }
    };
    cancel.onclick = () => close(false);
    pwd.onkeydown = (e) => { if (e.key === 'Enter') ok.click(); };
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const lockBtn = document.getElementById('adminEditLockBtn');
  if (lockBtn) lockBtn.onclick = () => adminEdit.lock();
});
```

- [ ] **Step 3: Manual smoke test**

Reload the panel. The badge should NOT appear initially. From the browser console:
```js
ensureAdminEditMode().then(console.log)
```
A modal opens. Type wrong password → error. Type correct → modal closes, badge appears bottom-right showing "осталось 15 мин". Click 🔒 → badge disappears. Repeat — modal opens again.

- [ ] **Step 4: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): admin edit-mode unlock modal + badge"
```

---

## Task 11: Panel — inline edit/delete buttons in Финансы

**Files:**
- Modify: `Nicole_Beauty_Панель.html` (the function that renders the attendances list in Финансы — find it via `data.attendances` references near line 524)

- [ ] **Step 1: Locate the render**

Run:
```bash
grep -n "data.attendances" Nicole_Beauty_Панель.html
```
Find the place that builds each row (it likely emits `<tr>` or `<div>` per attendance for the Финансы month view). Inside the row template, add a trailing cell with the action buttons.

- [ ] **Step 2: Add per-row action buttons**

For each attendance row template, append (replace `att` with whatever loop variable name the existing code uses):

```html
<span class="ns-row-actions">
  <button type="button" title="Редактировать" data-act="edit"   data-id="${att.id}">✏️</button>
  <button type="button" title="Удалить"       data-act="delete" data-id="${att.id}">🗑️</button>
</span>
```

If the row is rendered for a soft-deleted record (only when "show deleted" toggle is on — Task 13), wrap the row's main content in `<span class="ns-row-deleted">` and replace the action span with a single ↩️ button:

```html
<span class="ns-row-actions">
  <button type="button" title="Восстановить" data-act="restore" data-id="${att.id}">↩️</button>
</span>
```

- [ ] **Step 3: Wire a single delegated click handler**

After the render function (or at the end of the script block), add:

```js
function attachAttendanceRowActions(containerEl) {
  if (!containerEl) return;
  containerEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = parseInt(btn.dataset.id);
    const act = btn.dataset.act;
    if (!id || !act) return;
    if (!(await ensureAdminEditMode())) return;
    const att = (data.attendances || []).find(a => a.id === id);
    if (!att) { alert('Запись не найдена в локальном кеше — обновите страницу.'); return; }
    if (act === 'edit')    openAttendanceEditModal(att);
    if (act === 'delete')  openAttendanceDeleteModal(att);
    if (act === 'restore') confirmRestore(att);
  });
}

async function confirmRestore(att) {
  if (!confirm(`Восстановить запись id=${att.id}?`)) return;
  const r = await fetch('/api/admin-attendance', {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'restore', id: att.id }),
  });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) { alert('Ошибка: ' + (j.error || r.status)); return; }
  await reloadFinanceMonth();
}

// Reload helper — call the existing functions that re-fetch + re-render the current finance month.
async function reloadFinanceMonth() {
  const m = currentFinanceMonth();   // existing function or state — adapt as needed
  await loadAttendancesForMonth(m);
  renderFinance();                   // existing render function — adapt name as needed
}
```

If `currentFinanceMonth()` / `renderFinance()` don't exist with those exact names, find the equivalents (search for `loadAttendancesForMonth` callers) and substitute.

In the place where the finance-month list is rendered (after innerHTML is set), call `attachAttendanceRowActions(containerEl)` once on the container element.

- [ ] **Step 4: Smoke test**

Reload the panel. Open Финансы, see ✏️ 🗑️ on each row. Click 🗑️ — should prompt the unlock modal first if not unlocked. Cancel for now (real delete tested in Task 12 / next tasks once modals exist; here just verify the buttons appear and trigger unlock prompt).

- [ ] **Step 5: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): inline edit/delete/restore buttons in Финансы"
```

---

## Task 12: Panel — edit modal

**Files:**
- Modify: `Nicole_Beauty_Панель.html` (modal HTML + open function + recompute preview)

- [ ] **Step 1: Add the edit modal HTML**

Just before `</body>` (next to the unlock modal):

```html
<div id="attEditModal" class="ns-modal-backdrop" hidden>
  <div class="ns-modal" style="max-width:640px">
    <h3 id="attEditTitle">Редактировать запись</h3>
    <div class="ns-muted" id="attEditSub"></div>

    <label>Дата<input type="date" id="aeDate"></label>
    <label>Время<input type="time" id="aeTime" step="60"></label>
    <label>Мастер<select id="aeMaster"></select></label>
    <label>Услуга<select id="aeService"></select></label>
    <label>Цена (₽)<input type="number" id="aePrice" min="0" step="10"></label>
    <label><input type="checkbox" id="aeSalon"> Салонные продукты (комиссия ниже)</label>
    <label>Клиент<input type="text" id="aeClient" maxlength="200"></label>
    <label>Оплата<input type="text" id="aePayment" maxlength="40"></label>
    <label>Заметка<textarea id="aeNote" maxlength="500" rows="2"></textarea></label>
    <label>Причина правки (для аудита)<input type="text" id="aeReason" maxlength="500"></label>

    <div class="ns-muted" id="aePreview"></div>
    <div id="aeErr" class="ns-err" hidden></div>

    <div class="ns-modal-actions">
      <button type="button" id="aeCancel">Отмена</button>
      <button type="button" id="aeOk" class="primary">Сохранить</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add the JS to populate selects + open + preview + submit**

```js
// Cache for master_services rates so preview can recompute client-side.
// Loaded lazily on first modal open.
let _msRatesCache = null;
async function loadMsRates() {
  if (_msRatesCache) return _msRatesCache;
  const { data: rows, error } = await sb
    .from('master_services')
    .select('master_id, service_id, price, commission_master_pct, commission_master_pct_salon');
  if (error) throw error;
  _msRatesCache = rows || [];
  return _msRatesCache;
}

function _findRate(masterId, serviceId) {
  return (_msRatesCache || []).find(r => r.master_id === masterId && r.service_id === serviceId);
}

function _previewPay(masterId, serviceId, price, usesSalon) {
  const r = _findRate(masterId, serviceId);
  if (!r) return { txt: 'Услуга не настроена для этого мастера', ok: false };
  const pct = usesSalon ? Number(r.commission_master_pct_salon) : Number(r.commission_master_pct);
  const pay = Math.round(price * pct) / 100;
  const max = (Number(r.price) || 0) * 10;
  if (max && price > max) return { txt: `Цена превышает лимит (макс ${max})`, ok: false };
  return { txt: `Мастеру: ${pay.toLocaleString('ru-RU')} ₽ (${pct}%)`, ok: true };
}

function _populateMasterSelect(sel, selectedId) {
  sel.innerHTML = (data.masters || [])
    .map(m => `<option value="${m.id}" ${m.id===selectedId?'selected':''}>${m.name}</option>`).join('');
}
function _populateServiceSelect(sel, selectedId) {
  sel.innerHTML = (data.services || [])
    .map(s => `<option value="${s.id}" ${s.id===selectedId?'selected':''}>${s.name}</option>`).join('');
}

async function openAttendanceEditModal(att) {
  await loadMsRates();
  const $ = (id) => document.getElementById(id);
  $('attEditTitle').textContent = 'Редактировать запись';
  $('attEditSub').textContent = `id=${att.id} · создано ${att.date} ${String(att.time||'').slice(0,5)}`;
  $('aeDate').value = att.date;
  $('aeTime').value = String(att.time || '').slice(0,5);
  _populateMasterSelect($('aeMaster'), att.master_id);
  _populateServiceSelect($('aeService'), att.service_id);
  $('aePrice').value  = att.price;
  $('aeSalon').checked = !!att.uses_salon_products;
  $('aeClient').value = att.client_name || '';
  $('aePayment').value = att.payment_method || '';
  $('aeNote').value = att.note || '';
  $('aeReason').value = '';
  $('aeErr').hidden = true;

  const refreshPreview = () => {
    const r = _previewPay(parseInt($('aeMaster').value), parseInt($('aeService').value),
                          Number($('aePrice').value || 0), $('aeSalon').checked);
    $('aePreview').textContent = r.txt;
    $('aePreview').style.color = r.ok ? '#374151' : '#b91c1c';
  };
  ['aeMaster','aeService','aePrice','aeSalon'].forEach(id => $(id).oninput = refreshPreview);
  ['aeMaster','aeService'].forEach(id => $(id).onchange = refreshPreview);
  refreshPreview();

  $('attEditModal').hidden = false;

  $('aeCancel').onclick = () => $('attEditModal').hidden = true;
  $('aeOk').onclick = async () => {
    $('aeOk').disabled = true; $('aeErr').hidden = true;
    try {
      const fields = {
        date: $('aeDate').value,
        time: $('aeTime').value ? $('aeTime').value + ':00' : null,
        master_id:  parseInt($('aeMaster').value),
        service_id: parseInt($('aeService').value),
        price: Number($('aePrice').value),
        uses_salon_products: $('aeSalon').checked,
        client_name: $('aeClient').value || null,
        payment_method: $('aePayment').value || null,
        note: $('aeNote').value || null,
      };
      const r = await fetch('/api/admin-attendance', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'update', id: att.id, fields, reason: $('aeReason').value || null }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) { $('aeErr').textContent = j.error || 'Ошибка'; $('aeErr').hidden = false; return; }
      $('attEditModal').hidden = true;
      await reloadFinanceMonth();
    } catch (e) { $('aeErr').textContent = String(e.message || e); $('aeErr').hidden = false; }
    finally { $('aeOk').disabled = false; }
  };
}
```

- [ ] **Step 3: Smoke test**

Reload panel, unlock edit mode, click ✏️ on a row. Modal opens with values filled. Change the price → preview updates. Save → modal closes → list reloads → row shows new price. SQL check:
```sql
select id, price, master_pay, edited_at from attendances where id=<id>;
select action, before->>'price' p_old, after->>'price' p_new from attendance_audit
  where attendance_id=<id> order by id desc limit 1;
```

- [ ] **Step 4: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): edit-attendance modal with live recompute"
```

---

## Task 13: Panel — delete confirmation modal + show-deleted toggle

**Files:**
- Modify: `Nicole_Beauty_Панель.html`

- [ ] **Step 1: Add the delete modal HTML**

```html
<div id="attDeleteModal" class="ns-modal-backdrop" hidden>
  <div class="ns-modal">
    <h3>Удалить запись?</h3>
    <div class="ns-muted" id="adSummary"></div>
    <label>Причина (необязательно)<input type="text" id="adReason" maxlength="500"></label>
    <div id="adErr" class="ns-err" hidden></div>
    <div class="ns-modal-actions">
      <button type="button" id="adCancel">Отмена</button>
      <button type="button" id="adOk" class="danger">Удалить</button>
    </div>
  </div>
</div>
```

- [ ] **Step 2: Add the JS**

```js
function openAttendanceDeleteModal(att) {
  const $ = (id) => document.getElementById(id);
  $('adSummary').textContent =
    `${att.date} ${String(att.time||'').slice(0,5)} · ` +
    `${(data.masters.find(m=>m.id===att.master_id)||{}).name || '?'} · ` +
    `${att.service_name || '?'} · ${Number(att.price).toLocaleString('ru-RU')} ₽` +
    (att.client_name ? ` · ${att.client_name}` : '');
  $('adReason').value = '';
  $('adErr').hidden = true;
  $('attDeleteModal').hidden = false;

  $('adCancel').onclick = () => $('attDeleteModal').hidden = true;
  $('adOk').onclick = async () => {
    $('adOk').disabled = true; $('adErr').hidden = true;
    try {
      const r = await fetch('/api/admin-attendance', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', id: att.id, reason: $('adReason').value || null }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) { $('adErr').textContent = j.error || 'Ошибка'; $('adErr').hidden = false; return; }
      $('attDeleteModal').hidden = true;
      await reloadFinanceMonth();
    } catch (e) { $('adErr').textContent = String(e.message || e); $('adErr').hidden = false; }
    finally { $('adOk').disabled = false; }
  };
}
```

- [ ] **Step 3: Show-deleted toggle**

Find the Финансы tab header area. Add a checkbox in the controls bar (right side):

```html
<label class="ns-inline-toggle" style="font-size:13px;margin-left:12px">
  <input type="checkbox" id="finShowDeleted"> Показать удалённые
</label>
```

Modify `loadAttendancesForMonth(month)` to read this flag and adjust the query:

```js
async function loadAttendancesForMonth(month) {
  if (!sb || !month) { data.attendances = []; return; }
  // ... existing date math ...
  const showDeleted = !!document.getElementById('finShowDeleted')?.checked;
  let q = sb.from('attendances')
    .select('id, date, time, master_id, service_id, service_name, price, master_pay, commission_pct, uses_salon_products, client_name, payment_method, source, note, deleted_at, edited_at')
    .gte('date', from).lte('date', to)
    .order('date', { ascending: true });
  if (!showDeleted) q = q.is('deleted_at', null);
  const { data: rows, error } = await q;
  if (error) { console.warn('attendances load failed:', error.message); data.attendances = []; return; }
  data.attendances = rows || [];
}
```

Wire the toggle to reload:
```js
document.addEventListener('DOMContentLoaded', () => {
  const t = document.getElementById('finShowDeleted');
  if (t) t.onchange = () => reloadFinanceMonth();
});
```

In the row render template (Task 11), apply `class="ns-row-deleted"` to the main content wrapper when `att.deleted_at` is truthy, and swap the action buttons to the restore-only variant (already noted in Task 11).

- [ ] **Step 4: Smoke test**

Toggle "Показать удалённые" on after deleting a row → row reappears struck-through with ↩️. Click ↩️ → confirmed → row un-struck. Toggle off → row gone again.

- [ ] **Step 5: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): delete modal + show-deleted toggle + restore"
```

---

## Task 14: Panel — retroactive create button + modal

**Files:**
- Modify: `Nicole_Beauty_Панель.html`

- [ ] **Step 1: Add the button**

In the Финансы tab header (next to "Показать удалённые"), add:

```html
<button type="button" id="finRetroBtn" class="primary" style="margin-left:8px">+ Ретро-запись</button>
```

- [ ] **Step 2: Reuse the edit modal for "create"**

Add a parallel function that opens the same modal in create mode:

```js
async function openAttendanceCreateModal() {
  await loadMsRates();
  const $ = (id) => document.getElementById(id);
  $('attEditTitle').textContent = 'Новая ретро-запись';
  $('attEditSub').textContent = '';
  const now = new Date();
  const pad = n => String(n).padStart(2,'0');
  $('aeDate').value = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`;
  $('aeTime').value = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
  _populateMasterSelect($('aeMaster'), (data.masters[0]||{}).id);
  _populateServiceSelect($('aeService'), (data.services[0]||{}).id);
  $('aePrice').value = '';
  $('aeSalon').checked = false;
  $('aeClient').value = '';
  $('aePayment').value = '';
  $('aeNote').value = '';
  $('aeReason').value = '';
  $('aeErr').hidden = true;

  const refreshPreview = () => {
    const r = _previewPay(parseInt($('aeMaster').value), parseInt($('aeService').value),
                          Number($('aePrice').value || 0), $('aeSalon').checked);
    $('aePreview').textContent = r.txt;
    $('aePreview').style.color = r.ok ? '#374151' : '#b91c1c';
  };
  ['aeMaster','aeService','aePrice','aeSalon'].forEach(id => $(id).oninput = refreshPreview);
  ['aeMaster','aeService'].forEach(id => $(id).onchange = refreshPreview);
  refreshPreview();

  $('attEditModal').hidden = false;
  $('aeCancel').onclick = () => $('attEditModal').hidden = true;
  $('aeOk').onclick = async () => {
    $('aeOk').disabled = true; $('aeErr').hidden = true;
    try {
      const fields = {
        date: $('aeDate').value,
        time: $('aeTime').value + ':00',
        master_id:  parseInt($('aeMaster').value),
        service_id: parseInt($('aeService').value),
        price: Number($('aePrice').value),
        uses_salon_products: $('aeSalon').checked,
        client_name: $('aeClient').value || null,
        payment_method: $('aePayment').value || null,
        note: $('aeNote').value || null,
      };
      const r = await fetch('/api/admin-attendance', {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'create', fields, reason: $('aeReason').value || null }),
      });
      const j = await r.json().catch(()=>({}));
      if (!r.ok) { $('aeErr').textContent = j.error || 'Ошибка'; $('aeErr').hidden = false; return; }
      $('attEditModal').hidden = true;
      await reloadFinanceMonth();
    } catch (e) { $('aeErr').textContent = String(e.message || e); $('aeErr').hidden = false; }
    finally { $('aeOk').disabled = false; }
  };
}

document.addEventListener('DOMContentLoaded', () => {
  const b = document.getElementById('finRetroBtn');
  if (b) b.onclick = async () => { if (await ensureAdminEditMode()) openAttendanceCreateModal(); };
});
```

- [ ] **Step 3: Smoke test**

Click "+ Ретро-запись" → unlock if needed → modal opens with current date/time → fill master/service/price → save → row appears in list. SQL:
```sql
select id, source, date, time, price, master_pay from attendances order by id desc limit 1;
-- expect source='admin_retro'
select action from attendance_audit order by id desc limit 1;
-- expect 'create_retro'
```
Telegram: a `➕ Ретро-запись` message arrived.

- [ ] **Step 4: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): retroactive attendance creation modal"
```

---

## Task 15: Panel — "Журнал правок" tab

**Files:**
- Modify: `Nicole_Beauty_Панель.html`

- [ ] **Step 1: Add the tab nav entry**

Find the existing tab nav (search for the strings of existing tab labels, e.g. `Финансы`). Add a button/link for `Журнал правок` matching the pattern used by other tabs (same class names, same data attribute). Example pattern (adapt to actual structure):

```html
<button class="tab-btn" data-tab="audit">Журнал правок</button>
```

And the tab pane:

```html
<section id="tab-audit" class="tab-pane" hidden>
  <div class="audit-controls" style="display:flex;gap:8px;align-items:end;flex-wrap:wrap;margin-bottom:12px">
    <label>С<input type="date" id="auFrom"></label>
    <label>По<input type="date" id="auTo"></label>
    <label>Мастер<select id="auMaster"><option value="">(все)</option></select></label>
    <label>Действие<select id="auAction">
      <option value="">(все)</option>
      <option value="create_retro">создание</option>
      <option value="update">правка</option>
      <option value="delete">удаление</option>
      <option value="restore">восстановление</option>
    </select></label>
    <button type="button" id="auReload" class="primary">Обновить</button>
  </div>
  <div id="auTableWrap"></div>
  <div id="auPager" style="margin-top:8px;display:flex;gap:8px;align-items:center"></div>
</section>
```

- [ ] **Step 2: Add render code**

```js
const audit = { rows: [], total: 0, limit: 50, offset: 0, expanded: new Set() };

async function loadAudit() {
  if (!(await ensureAdminEditMode())) return;
  const $ = id => document.getElementById(id);
  // populate master select once
  const sel = $('auMaster');
  if (sel.options.length <= 1) {
    sel.innerHTML = '<option value="">(все)</option>' +
      (data.masters || []).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
  }
  const params = new URLSearchParams();
  if ($('auFrom').value) params.set('from', $('auFrom').value);
  if ($('auTo').value)   params.set('to',   $('auTo').value);
  if ($('auMaster').value) params.set('master_id', $('auMaster').value);
  if ($('auAction').value) params.set('action', $('auAction').value);
  params.set('limit',  audit.limit);
  params.set('offset', audit.offset);
  const r = await fetch('/api/admin-audit?' + params.toString(), { credentials: 'same-origin' });
  const j = await r.json().catch(()=>({}));
  if (!r.ok) { $('auTableWrap').textContent = j.error || 'Ошибка'; return; }
  audit.rows = j.rows || []; audit.total = j.total || audit.rows.length;
  renderAudit();
}

function _masterName(id) { return (data.masters.find(m=>m.id===id)||{}).name || `id=${id}`; }
function _actionLabel(a) {
  return { create_retro:'➕ создание', update:'🛠️ правка', delete:'🗑️ удаление', restore:'↩️ восстановление' }[a] || a;
}
function _diffSummary(before, after) {
  if (!before)  return '(новая запись)';
  if (!after)   return '(удалена)';
  const watch = ['date','time','master_id','service_id','price','master_pay','commission_pct','uses_salon_products','client_name','payment_method','note'];
  const diffs = watch.filter(k => String(before[k] ?? '') !== String(after[k] ?? ''));
  return diffs.length ? diffs.map(k => `${k}: ${before[k] ?? '—'} → ${after[k] ?? '—'}`).join('; ') : '(без изменений)';
}

function renderAudit() {
  const wrap = document.getElementById('auTableWrap');
  if (!audit.rows.length) { wrap.innerHTML = '<p class="ns-muted">Нет записей.</p>'; renderAuditPager(); return; }
  const rows = audit.rows.map(row => {
    const masterId = row.before?.master_id ?? row.after?.master_id;
    const expanded = audit.expanded.has(row.id);
    const detail = expanded ? `<tr><td colspan="6"><pre style="white-space:pre-wrap;background:#f9fafb;padding:8px;border-radius:6px;font-size:12px">BEFORE: ${escapeHtml(JSON.stringify(row.before, null, 2))}\n\nAFTER:  ${escapeHtml(JSON.stringify(row.after, null, 2))}</pre></td></tr>` : '';
    return `<tr data-aid="${row.id}" style="cursor:pointer">
      <td>${new Date(row.created_at).toLocaleString('ru-RU')}</td>
      <td>${row.actor}</td>
      <td>${_actionLabel(row.action)}</td>
      <td>id=${row.attendance_id}<br><small>${escapeHtml(_masterName(masterId))}</small></td>
      <td>${escapeHtml(_diffSummary(row.before, row.after))}</td>
      <td>${escapeHtml(row.reason || '')}</td>
    </tr>${detail}`;
  }).join('');
  wrap.innerHTML = `<table class="ns-table" style="width:100%;border-collapse:collapse">
    <thead><tr><th>Когда</th><th>Кто</th><th>Действие</th><th>Запись</th><th>Изменения</th><th>Причина</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
  wrap.querySelectorAll('tr[data-aid]').forEach(tr => tr.onclick = () => {
    const id = parseInt(tr.dataset.aid);
    if (audit.expanded.has(id)) audit.expanded.delete(id); else audit.expanded.add(id);
    renderAudit();
  });
  renderAuditPager();
}

function renderAuditPager() {
  const p = document.getElementById('auPager');
  const totalPages = Math.max(1, Math.ceil(audit.total / audit.limit));
  const cur = Math.floor(audit.offset / audit.limit) + 1;
  p.innerHTML = `<button id="auPrev" ${cur<=1?'disabled':''}>←</button>
    <span>стр. ${cur} из ${totalPages} · всего ${audit.total}</span>
    <button id="auNext" ${cur>=totalPages?'disabled':''}>→</button>`;
  document.getElementById('auPrev').onclick = () => { audit.offset = Math.max(0, audit.offset - audit.limit); loadAudit(); };
  document.getElementById('auNext').onclick = () => { audit.offset += audit.limit; loadAudit(); };
}

function escapeHtml(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

document.addEventListener('DOMContentLoaded', () => {
  const reload = document.getElementById('auReload');
  if (reload) reload.onclick = () => { audit.offset = 0; loadAudit(); };
});
```

- [ ] **Step 3: Hook into existing tab-switch logic**

Find the existing tab activation code (search for `data-tab` or `tab-btn`). Where it activates a tab, add: when activating `audit` for the first time (or on every activation), call `loadAudit()`.

- [ ] **Step 4: Smoke test**

Open Журнал правок tab → unlock if needed → list of audit rows appears with most-recent first. Click a row → expands to show JSON before/after. Filter by Action=удаление → list refreshes. Pager works.

- [ ] **Step 5: Commit**

```bash
git add Nicole_Beauty_Панель.html
git commit -m "feat(panel): Журнал правок (audit log) tab"
```

---

## Task 16: End-to-end smoke test + README note

**Files:**
- Modify: `README.md` (add a short note about new env var + admin features)

- [ ] **Step 1: Add README note**

Append to README.md a short section:

```markdown
### Admin edit/delete attendances (since 2026-04)

The administrator can edit, soft-delete, restore, and create retroactive attendance
records via the panel. Authentication uses an HMAC-signed cookie ("edit mode")
valid for 15 minutes.

**Required env var:**
- `ADMIN_SESSION_SECRET` — random string, ≥16 chars. Generate with
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

All admin actions are logged in `attendance_audit` and broadcast to the
configured Telegram chat.
```

- [ ] **Step 2: Run a full end-to-end pass in the browser**

1. Reload panel, lock state — no badge.
2. Click 🗑️ on a row → unlock modal → wrong password → error → correct password → badge appears → delete modal opens → confirm with reason "duplicado" → row disappears.
3. Toggle "Показать удалённые" → row reappears struck → click ↩️ → row restored.
4. Click ✏️ on a row → change price → preview updates → save → row updated, telegram message arrived.
5. Click "+ Ретро-запись" → fill form for yesterday → save → row appears, source=admin_retro, telegram arrived.
6. Open Журнал правок → see all 4 actions (delete, restore, update, create_retro). Expand each → JSON diff visible. Filter by master → narrows. Pager → works if >50 rows.
7. Click 🔒 on badge → badge gone. Click ✏️ again → unlock modal opens.
8. Verify in `register.html` (master app) the deleted record is NOT visible to the master either.

- [ ] **Step 3: Commit and ship**

```bash
git add README.md
git commit -m "docs: admin edit-mode env var + features note"
```

Set `ADMIN_SESSION_SECRET` in Vercel:
```bash
vercel env add ADMIN_SESSION_SECRET
# paste the generated secret, select production+preview+development
```

Then deploy:
```bash
vercel --prod
```

Run smoke steps 1-8 again on production.

---

## Self-review notes (already addressed inline)

- Spec sections all mapped to tasks: data model → Task 1; read filtering → Task 2; admin-session → Tasks 3-4; admin-attendance CRUD → Tasks 5-8; audit endpoint → Task 9; UI inline + modals → Tasks 10-14; audit tab → Task 15; deployment & docs → Task 16.
- No `TBD`/`TODO` placeholders.
- Function/property names consistent across tasks: `ensureAdminEditMode`, `reloadFinanceMonth`, `openAttendanceEditModal`, `openAttendanceDeleteModal`, `openAttendanceCreateModal`, `loadAudit`, `_msRatesCache`, `computePay`, `notifyTelegram`.
- Soft-delete column name `deleted_at` consistent everywhere.
- Action vocabulary `create | update | delete | restore` (request) maps to `create_retro | update | delete | restore` (audit) — distinction explicit in Tasks 5 and 6.
