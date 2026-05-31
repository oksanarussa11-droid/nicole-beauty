# Public Site v1 — Session Handoff

> **Purpose:** Hand off mid-task to a fresh session. The spec (`docs/public-site-v1.md`) was read, the codebase was explored, and the four open architecture decisions were resolved with the user. The next step is to **write the implementation plan** (and then execute it). This document gives a fresh session everything it needs to continue **without re-exploring or re-asking**.
>
> **Date of handoff:** 2026-05-30 · **Branch:** main (clean working tree)

---

## 0. Where we are in the workflow

The task was: `/superpowers:using-superpowers` → "**leia e execute** `docs/public-site-v1.md`".

Progress so far:
1. ✅ Read the spec (`docs/public-site-v1.md`) — a product-brainstorm capture for a public client-facing salon site.
2. ✅ Invoked the **`superpowers:writing-plans`** skill (this is the active process skill — keep using it).
3. ✅ Explored the existing codebase thoroughly (findings below — trust them, do not re-explore from scratch).
4. ✅ Asked the user the 4 genuinely-open architecture decisions (the spec itself deferred frontend choice to "the implementation plan"). **All 4 answered — see §1.**
5. ⏭️ **NEXT: write the no-placeholder implementation plan** to `docs/superpowers/plans/2026-05-30-public-site-v1.md`, following the `superpowers:writing-plans` skill format (TDD, bite-sized steps, exact file paths, complete code, no placeholders). Then offer the execution-handoff choice (subagent-driven vs inline).

The §6 task breakdown below is the **intended structure of that plan** — already designed, ready to be expanded into full no-placeholder tasks.

---

## 1. Locked-in decisions (asked & answered by the user)

| # | Decision | **User chose** | Implication |
|---|----------|----------------|-------------|
| 1 | Frontend tech | **Next.js app** (App Router) | New Next.js app in a subdirectory, deployed as a **separate Vercel project** (Root Directory = the subdir). Does NOT disturb the existing static admin/pro sites at repo root. |
| 2 | Booking capture / Telegram | **Direct API capture** | Form → new `/api/booking-create` (Next.js Route Handler) → writes a `booking_requests` row → notifies admin via the **existing outbound Telegram `sendMessage`** pattern. **No interactive bot/webhook** (that was the rejected option). |
| 3 | v1 page scope | **Landing only** | One mobile-first scrolling landing + booking widget. Depth pages (full catalog, per-master profile pages, full gallery) are **deferred**. Matches the spec's "cheapest test" soft-launch. |
| 4 | Content/prices source | **Live from Supabase** | Add `photo_url`/`bio`/`display_order`/`is_public` columns to `masters`; surface real `master_services.price`; **admin fills them in the panel** (`index.html`). NOT an editable content file, NOT hardcoded. |

### Derived design decisions (made by the planning agent — keep these unless the user objects)
- **Subdirectory name:** `public-site/` (the Next.js app). Adjust only if the user prefers `web/` etc.
- **No new dependency for DB access:** mirror the existing repo pattern — **raw `fetch` to PostgREST** (`/rest/v1/...`), not `@supabase/supabase-js`, on the server side. Reads use the **anon key** (server-side, least privilege, RLS-protected). Writes use the **service-role key** (in the Route Handler only). This matches `api/attendance.js` exactly and avoids version drift.
- **Reads via Server Components with ISR:** `fetch(url, { next: { revalidate: 300 } })`. Salon data changes rarely; great for SEO + speed. (Confirmed current idiom via context7 for `/vercel/next.js`.)
- **Booking UX = synthesis of spec + direct-capture:** the form keeps the spec's **two channel buttons** ("Записаться через Telegram" / "Написать в WhatsApp"). Each click: validate → `POST /api/booking-create` (records + notifies admin) → then open the channel deep-link (`wa.me/<num>?text=<prefilled>` for WhatsApp; `t.me/<username>` for Telegram — a normal chat can't be prefilled, but the admin already received the full request via the API notify). This captures **every** request (the primary metric) regardless of whether the client finishes the chat.
- **Photo hosting:** `masters.photo_url` is a **plain text URL**. For v1, host images in a **Supabase Storage public bucket** (provide the bucket-creation SQL; admin pastes the resulting public URL into the panel) — or any image URL. No upload UI is built for v1 (only 2 masters; pasting a URL is fine). Note this as a future enhancement.
- **Gallery deferral:** the spec calls the before/after gallery "the funnel," but there is **no gallery data/table** and content readiness is uncertain. For the landing-only soft-launch, **master portraits + bios** (which we ARE adding) serve as the visual proof, plus external reviews (2gis/Yandex). A `gallery_photos` table + admin UI is an explicit **fast-follow**, not v1.
- **PII / security (IMPORTANT):** `booking_requests` holds client contact info. Its RLS must be **service-role only (no anon policies)** — same as `pin_attempts`. The public anon key must **never** be able to read client phone numbers. Consequence: the admin panel (which uses the anon key) **cannot** read `booking_requests` directly in v1 → admin sees requests **via Telegram**. A future `/api/booking-list` (service-role, admin-password-gated) can surface them in-panel. Out of scope for v1.
- **Route Handler responses:** use the Web-standard `Response.json(data, { status })` (not `next/server`'s `NextResponse`) so unit tests don't need to import `next/server`.

---

## 2. The spec in one paragraph

Convert curious visitors (coming from Instagram / Telegram / 2gis.ru / WhatsApp) into **booking requests**, conveying credibility + professionalism without losing the human touch. The site is the **conversion + credibility layer**, not a discovery magnet. Market = Russia, language = **Russian only**. Client picks a specific professional (with a "не знаю, кого выбрать — помогите" / "help me choose" escape hatch). **Primary metric:** number of requests/month (counted by the API write). **Secondary:** Yandex.Metrica funnel (landing view → CTA click → request sent). Non-goals for v1: real-time scheduling, online payment, client login, auto-reminders, blog, languages other than Russian. Full spec: `docs/public-site-v1.md`.

---

## 3. Existing codebase map (verified — do not re-explore)

**Stack:** Pure static HTML/CSS/JS + Vercel serverless `/api` (CommonJS Node handlers) + Supabase (PostgreSQL via PostgREST). **No `package.json`, no build step** at repo root. Two Vercel projects deploy from the same root (admin site + "pro" site, swapped via `SITE=pro` env in `vercel.json`'s `buildCommand`).

**Supabase project ref:** `gyixkgytywjtttcnynzn` → URL `https://gyixkgytywjtttcnynzn.supabase.co`.

**Repo-tracked files (47 total) — key ones:**
```
index.html            ← Admin dashboard (216 KB single file; supabase-js via CDN, anon key)
register.html         ← "Pro" master self-service form (served as index when SITE=pro)
report.html           ← Analytics/reports UI
config.js             ← Public Supabase URL + anon key, auto-switches localhost/prod
vercel.json           ← cleanUrls, SITE=pro buildCommand swap, security headers, outputDirectory "."
assets/nicole-logo.png
api/_lib/admin-session.js   ← HMAC-signed admin cookie helpers
api/attendance.js     ← ★ BEST TEMPLATE for the new booking endpoint (sb() + Telegram + validation)
api/appointment.js    ← Appointment create/patch/complete + Telegram; has fetchMasterName()
api/admin-attendance.js, api/admin-audit.js, api/admin-session.js
api/verify-pin.js, api/set-pin.js, api/verify-admin.js
api/parse-report.js   ← Vision OCR (Anthropic)
supabase/schema.sql   ← ★ Source-of-truth schema (paste-and-run in Supabase SQL editor)
supabase/migrations/001..007_*.sql + 20260426185854_appointments_create_table.sql
docs/public-site-v1.md          ← the spec
docs/public-site-v1-HANDOFF.md  ← this file
docs/superpowers/plans/*.md     ← prior plans (naming convention to follow)
docs/superpowers/specs/*.md
```

### 3a. Supabase access patterns
- **Browser (admin/pro pages):** `@supabase/supabase-js` client named `sb`, created from `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY` (set in `config.js`). Reads via `sb.from('masters_public').select('*')`; writes **directly** to base tables via anon key (RLS has permissive `anon_all_*` policies for `masters`, `services`, `master_services`, etc.). e.g. `index.html:2681` `sb.from('masters').insert({ name, specialty })`.
- **Server (`/api/*`):** raw `fetch` to PostgREST with the **service-role** key. The reusable helper is `sb(method, path, body)` — see `api/attendance.js:38-54`. Pattern:
  ```js
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: { apikey: SERVICE_ROLE, Authorization: 'Bearer ' + SERVICE_ROLE,
               'Content-Type': 'application/json',
               Prefer: method === 'POST' ? 'return=representation' : 'return=minimal' },
    body: body ? JSON.stringify(body) : undefined,
  });
  ```

### 3b. Schema (relevant tables — see `supabase/schema.sql`)
- `masters(id bigserial pk, name text unique, specialty text, active bool default true, pin_hash text, created_at)` — **needs new columns** for the public site.
- `services(id bigserial pk, name text unique, created_at)`.
- `master_services(id, master_id fk, service_id fk, price numeric(12,2) default 0, commission_master_pct numeric(5,2) default 50, commission_master_pct_salon numeric(5,2) default 40, created_at, unique(master_id, service_id))` — **prices are per-master and currently seeded at 0**; admin must fill real prices.
- View `masters_public` = `select id, name, specialty, active, created_at from masters;` granted to anon — **excludes `pin_hash`**. **Must be updated** to expose the new public columns.
- Other tables: `attendances`, `appointments`, `day_summaries`, `income`, `expenses`, `inventory`, `pin_attempts` (service-role only, used for rate-limiting), `attendance_audit`.
- Seed: masters Людмила & Ирина (specialty "Волосы"); services Стрижка/Окрашивание/Укладка/Уход.
- **RLS model:** `anon_all_*` permissive policies on content tables (loop at `schema.sql:141-153`); `pin_attempts` & `attendance_audit` = service-role only (no anon policies = default deny). **Follow the `pin_attempts` model for `booking_requests`.**

### 3c. Telegram (outbound only — reuse this)
- In `api/attendance.js:163-200` (also in `appointment.js`, `admin-attendance.js`).
- Guarded by `process.env.TELEGRAM_BOT_TOKEN` && `process.env.TELEGRAM_CHAT_ID` (if absent → silently skip).
- POSTs to `https://api.telegram.org/bot${TOKEN}/sendMessage` with `{ chat_id, text, parse_mode: 'Markdown' }`, wrapped in a 3s `AbortController` timeout, fire-and-forget (logs errors, never throws).
- `escMd()` escapes Markdown special chars: `api/attendance.js:61` → `String(s||'').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1')`.
- **No inbound webhook bot exists.** The new site reuses this same bot + chat so the admin gets all notifications in one place.

### 3d. Admin panel content-editing (for Decision 4 / Task: admin UI)
- Masters list rendered by `renderMasters()` — `index.html:2329-2366`. Row currently: name, specialty, PIN button, delete button. The master_services price/commission grid is rendered in the same function (`index.html:2353-2360`) with inline `<input>`s keyed `msPrice_${m.id}_${s.id}` etc.
- `addMaster()` — `index.html:2677-2686`: `sb.from('masters').insert({ name, specialty })` then `loadAll()`.
- `saveMS(masterId, serviceId, msId)` — `index.html:2698-2718`: reads inline inputs, `sb.from('master_services').update(payload).eq('id', msId)` (or insert). **This is the pattern to mirror** for a new `saveMaster(id)` that updates `photo_url/bio/specialty/display_order/is_public` via `sb.from('masters').update(...).eq('id', id)`.
- Masters are loaded via `sb.from('masters_public').select('*').order('name')` (`index.html:1695`) → since it's `select('*')`, new view columns appear automatically once the view is updated.
- **No master-edit UI exists today** (only add + delete + PIN) → Task adds inline editing of the new fields.
- Helpers available in `index.html`: `escapeText()`, `toast(msg, isError)`, `val(id)`, `setVal(id, v)`, `loadAll()`, global `state.masters` / `state.services` / `state.masterServices`.

### 3e. Environment variables (existing)
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (server), anon key is public in `config.js`.
- `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET` (admin auth).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (optional; empty in dev → notifications disabled).
- `ANTHROPIC_API_KEY` (admin OCR only), `SITE=pro` (pro project).
- No analytics wired anywhere today (no GA, no Yandex.Metrica).

---

## 4. Target architecture for the public site

```
public-site/                         ← NEW Next.js app (separate Vercel project, Root Directory = public-site)
  app/
    layout.tsx                       ← <html lang="ru">, fonts (Cormorant Garamond + DM Sans), SEO metadata, Yandex.Metrica <Script>
    page.tsx                         ← Server Component landing; fetches masters/services/prices (ISR 300s); composes sections
    globals.css                      ← ported design tokens (--accent etc.) from index.html for brand consistency
    api/booking-create/route.ts      ← POST: validate → insert booking_requests (service role) → Telegram notify; Response.json
  components/
    Hero.tsx, Masters.tsx, Services.tsx, Reviews.tsx, Contact.tsx   ← server sections
    BookingWidget.tsx                ← 'use client'; service→master(or "помогите выбрать")→day+period→name+contact+note; two buttons
  lib/
    supabase.ts                      ← sbSelect(path, revalidate) raw PostgREST fetch w/ anon key (server)
    data.ts                          ← getPublicMasters(), getServices(), getMasterServices(), servicePrices() (pure)
    telegram.ts                      ← escMd(), notifyAdmin(text) (ported from api/attendance.js)
    metrica.ts                       ← reachGoal(name) wrapper (no-ops if ym undefined)
  .env.local.example
  package.json, tsconfig.json, next.config.ts, vitest.config.ts
supabase/
  migrations/008_booking_requests.sql        ← NEW table + service-role-only RLS
  migrations/009_masters_public_fields.sql   ← add columns + update masters_public view
  schema.sql                                 ← update to keep source-of-truth in sync
index.html                                   ← extend renderMasters() + add saveMaster() (admin content editing)
```

### `booking_requests` table (Task: migration 008)
```
id bigserial pk
created_at timestamptz not null default now()
service_id bigint references services(id) on delete set null
service_name text                 -- snapshot
master_id bigint references masters(id) on delete set null
master_name text                  -- snapshot, or 'Помогите выбрать'
help_choosing boolean not null default false
preferred_day text                -- free text/date ("2026-06-03" or "ближайшие выходные")
preferred_period text             -- утро/день/вечер/любое
client_name text not null
client_contact text not null
contact_method text               -- telegram | whatsapp | phone
note text
status text not null default 'new'   -- new | contacted | scheduled | closed
source text not null default 'public_site'
ip text
user_agent text
```
RLS: `enable row level security` + **NO anon policies** (service-role only). Add an index on `created_at` (and `ip, created_at` for the rate-limit query). Rate-limit in the Route Handler: ≤5 requests/min per IP (mirror the `pin_attempts` count-in-last-60s technique from `api/attendance.js:92-101`).

### `masters` public columns (Task: migration 009)
```sql
alter table masters add column if not exists photo_url text;
alter table masters add column if not exists bio text;
alter table masters add column if not exists display_order int not null default 100;
alter table masters add column if not exists is_public boolean not null default true;

create or replace view masters_public as
  select id, name, specialty, active, photo_url, bio, display_order, is_public, created_at
  from masters;
grant select on masters_public to anon, authenticated;
```
Public site query: `masters_public?is_public=eq.true&active=eq.true&order=display_order.asc,name.asc&select=...`. Admin still sees all masters (no filter) — existing `select('*')` keeps working.

### New env vars (public-site Vercel project)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY` (server reads), `SUPABASE_SERVICE_ROLE_KEY` (booking writes).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` (reuse the SAME bot/chat as the admin system).
- `NEXT_PUBLIC_YANDEX_METRICA_ID` (analytics counter).
- `NEXT_PUBLIC_WHATSAPP_NUMBER` (digits only, for `wa.me`), `NEXT_PUBLIC_TELEGRAM_CONTACT` (username for `t.me`), optional `NEXT_PUBLIC_PHONE` (display).

---

## 5. Verified-current technical idioms (from context7 `/vercel/next.js`)
- ISR in a Server Component: `await fetch(url, { next: { revalidate: 300 } })`.
- Route Handler: `export async function POST(req: Request) { ... return Response.json(obj, { status }) }` in `app/api/<name>/route.ts`.
- Third-party scripts: use `next/script` (`@next/third-parties` has a `GoogleAnalytics` helper but **not** Yandex.Metrica → inject the YM counter snippet via `next/script` with `strategy="afterInteractive"`).
- Node 24 is the Vercel default; default function timeout 300s; Fluid Compute (regular Node, not edge).

---

## 6. Intended task breakdown for the plan (expand each into full TDD no-placeholder steps)

Apply TDD (`vitest`) to the **testable logic** (lib helpers, `servicePrices()`, validation, the Route Handler with mocked `fetch`). Use **build + run/verify** steps for the visual landing (the `superpowers:verification-before-completion` and `verify`/`run` skills at execution time).

1. **Scaffold** `public-site/` — `create-next-app@latest` (TypeScript, App Router, ESLint, **no Tailwind** — use vanilla CSS to match repo ethos, no `src/` dir, import alias `@/*`). Add `vitest` + `vitest.config.ts` (node env, `@` alias) + `test` script. Verify `npm run build` and `npm test` run.
2. **Base layout & tokens** — `app/globals.css` (port `--accent`/`--positive`/etc. + Cormorant Garamond + DM Sans), `app/layout.tsx` (`<html lang="ru">`, SEO `metadata`, Yandex.Metrica `<Script>` gated on `NEXT_PUBLIC_YANDEX_METRICA_ID`).
3. **Migration 008** — `booking_requests` table + indexes + service-role-only RLS. Update `supabase/schema.sql`.
4. **Migration 009** — `masters` public columns + `masters_public` view update. Update `supabase/schema.sql`.
5. **`lib/supabase.ts`** — `sbSelect(path, revalidate=300)` raw PostgREST fetch w/ anon key; throws on non-OK. TDD with mocked global `fetch`.
6. **`lib/data.ts`** — `getPublicMasters/getServices/getMasterServices` + pure `servicePrices(services, ms, publicMasterIds)` returning `{ service, from }` (min price>0 across public masters, else null). TDD the pure fn.
7. **`lib/telegram.ts`** — port `escMd()` (TDD it) + `notifyAdmin(text)` (3s AbortController, env-gated, never throws).
8. **`app/api/booking-create/route.ts`** — validate (client_name+client_contact required; cap lengths; whitelist contact_method; help_choosing nulls master), IP rate-limit ≤5/min, insert via service-role `sb()`, build Russian Markdown message + `notifyAdmin`, `Response.json({ ok, id })`. TDD: 400 missing name, 429 rate-limited, 200 happy path (mock `fetch` queue for the Supabase GET/POST + Telegram).
9. **Landing sections** — `app/page.tsx` (Server Component, fetch via lib/data, pass data as props) composing `Hero`, `Masters` (photo+name+specialty+bio cards), `Services` (name + "от {from} ₽" or "Цена по запросу"), `Reviews` (2gis/Yandex external links), `Contact` (phone/Telegram/WhatsApp + map embed/link), sticky "Записаться" CTA. Graceful when content sparse. Verify with `next build` + screenshot.
10. **`BookingWidget.tsx`** (`'use client'`) — receives `services`, `masters`, `masterServices`, `whatsappNumber`, `telegramContact` as props. State: serviceId, masterId|'help', day, period, name, contact, note. Shows selected master's price (from master_services) or range for "помогите выбрать". Two buttons (Telegram / WhatsApp): on click → validate → `reachGoal('cta_click')` → `POST /api/booking-create` (with snapshots + contact_method) → on ok `reachGoal('request_sent')` → open `wa.me/<num>?text=<encoded summary>` or `t.me/<username>` → success state. Disable during submit; error toast on failure.
11. **Admin content editing** — extend `index.html` `renderMasters()` to render inline inputs (specialty, photo_url, bio, display_order, is_public checkbox) + a Save button per master row; add `saveMaster(id)` mirroring `saveMS()` (`sb.from('masters').update({...}).eq('id', id)` → `toast` → `loadAll`). No schema/anon changes needed (permissive `anon_all_masters` already allows it; `select('*')` already loads new columns).
12. **Env + deploy config + docs** — `public-site/.env.local.example`, a `public-site/README.md` (local dev: `npm run dev`; needs SUPABASE_URL/ANON/SERVICE_ROLE + optional Telegram/Metrica), and notes for creating the **separate Vercel project** with Root Directory = `public-site` and the §4 env vars. (Repo-root `vercel.json` is untouched.)
13. **Verification & soft-launch checklist** — `npm run build` + `npm test` green; apply both migrations in Supabase; create the Vercel project + env; manual end-to-end (submit a request → row in `booking_requests` + Telegram message + WhatsApp/Telegram deep-link opens); admin fills 2 masters' photo/bio + real prices; Yandex.Metrica counter created + funnel goals (`cta_click`, `request_sent`) registered; then put the link in Instagram bio + 2gis and watch the funnel ~2–3 weeks before building depth pages.

---

## 7. Prerequisites / external dependencies (flag to the user before/at execution)
- **Telegram bot + chat ID:** must be configured in the new Vercel project env. Reuse the existing bot + admin chat (so all notifications land together). If `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` aren't set yet in prod, that's an ops step.
- **Yandex.Metrica counter:** the user must create one (yandex.ru/metrika) to get `NEXT_PUBLIC_YANDEX_METRICA_ID`.
- **Contact handles:** WhatsApp number (international digits) + Telegram username for the deep links.
- **Content readiness (Decision 4):** the gallery-as-funnel is deferred; v1 leans on **master portraits + bios + real prices**, which the admin must fill via the extended panel (Task 11) before launch. Master photos need hosting (Supabase Storage public bucket URL, or any image URL).
- **Supabase migrations** are applied by pasting into the Supabase SQL editor (per `supabase/schema.sql` header) or `supabase db push`. Project ref `gyixkgytywjtttcnynzn`.

---

## 8. Immediate next action for the fresh session
1. Re-read `docs/public-site-v1.md` (the spec) and this handoff.
2. (Optional) `Skill superpowers:writing-plans` to reload the format, then **write** `docs/superpowers/plans/2026-05-30-public-site-v1.md` using the §6 breakdown — full TDD, exact paths, complete code, **no placeholders**. The §3 code references (`api/attendance.js` `sb()`/Telegram/`escMd`, `index.html` `renderMasters`/`saveMS`, `config.js`, `schema.sql`) are the concrete patterns to copy.
3. Run the writing-plans **self-review** (spec coverage, placeholder scan, type consistency).
4. Offer the user the execution choice: **subagent-driven** (recommended) vs **inline** (`superpowers:executing-plans`).
5. Consider doing the work in a **git worktree** (per writing-plans + `superpowers:using-git-worktrees`) since it's a sizeable new feature.

> Tip: nothing has been written to code yet — only this handoff and the (pre-existing) spec. The working tree is clean on `main`.
