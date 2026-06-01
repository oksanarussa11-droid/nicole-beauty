# Services Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let salon staff hide individual services and set their display order on the public site, mirroring the existing masters curation.

**Architecture:** Add `display_order` + `is_public` columns to the `services` table (idempotent migration). The admin single-file app ([index.html](../../../index.html)) gets a per-row checkbox + number input + Save button, just like the masters table. The public site ([public-site/lib/data.ts](../../../public-site/lib/data.ts)) filters/orders services in one query, which feeds both the price list and the booking dropdown.

**Tech Stack:** Supabase Postgres (manual SQL migrations), vanilla JS admin (`index.html` + supabase-js v2), Next.js public site (TypeScript, REST via `sbSelect`).

> **Note on TDD:** This repo has no automated test runner for the admin (`index.html`) or SQL. Where a real test harness exists (the public-site TypeScript build), the verification step is `npx tsc --noEmit`. Elsewhere, verification is an explicit manual check with expected output. Follow the verification steps literally.

> **Deploy ordering (important):** Task 1 (the migration) MUST be run in Supabase **before** the public-site query change (Task 2) reaches production, or the public query will reference a column that doesn't exist yet. Land/commit in task order; run the SQL in Supabase before deploying Task 2.

---

### Task 1: Database migration + schema doc

**Files:**
- Create: `supabase/migrations/010_services_curation.sql`
- Modify: `supabase/schema.sql:19-23` (the `create table ... services` block)

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/010_services_curation.sql` with exactly:

```sql
alter table services add column if not exists display_order int not null default 100;
alter table services add column if not exists is_public boolean not null default true;
```

- [ ] **Step 2: Update the canonical schema for documentation parity**

In `supabase/schema.sql`, replace the services table block (lines 19-23):

```sql
create table if not exists services (
  id          bigserial primary key,
  name        text not null unique,
  created_at  timestamptz not null default now()
);
```

with:

```sql
create table if not exists services (
  id            bigserial primary key,
  name          text not null unique,
  display_order int not null default 100,
  is_public     boolean not null default true,
  created_at    timestamptz not null default now()
);
```

- [ ] **Step 3: Verify the migration is idempotent (static check)**

Run: `grep -c "if not exists" supabase/migrations/010_services_curation.sql`
Expected: `2` (both `alter table ... add column` statements are guarded, so re-running is safe).

- [ ] **Step 4: Apply the migration in Supabase (manual)**

In the Supabase dashboard (project `gyixkgytywjtttcnynzn`) → SQL Editor → New query → paste the contents of `supabase/migrations/010_services_curation.sql` → RUN.

Then verify the columns exist by running in the same SQL Editor:

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'services'
order by ordinal_position;
```

Expected: rows include `display_order` (integer, default 100) and `is_public` (boolean, default true), and every existing service row now has `is_public = true`, `display_order = 100`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/010_services_curation.sql supabase/schema.sql
git commit -m "feat(db): add display_order + is_public to services"
```

---

### Task 2: Public-site reads curated services

**Files:**
- Modify: `public-site/lib/data.ts` (the `Service` type, lines 15-19; and `getServices()`, lines 39-41)

- [ ] **Step 1: Extend the `Service` type**

In `public-site/lib/data.ts`, replace:

```typescript
export type Service = {
  id: number;
  name: string;
  created_at?: string;
};
```

with:

```typescript
export type Service = {
  id: number;
  name: string;
  display_order: number;
  is_public: boolean;
  created_at?: string;
};
```

- [ ] **Step 2: Filter and order the services query**

In `public-site/lib/data.ts`, replace:

```typescript
export async function getServices(): Promise<Service[]> {
  return sbSelect<Service[]>('services?select=*');
}
```

with:

```typescript
export async function getServices(): Promise<Service[]> {
  return sbSelect<Service[]>('services?is_public=eq.true&order=display_order.asc,name.asc');
}
```

- [ ] **Step 3: Verify the public-site still type-checks**

Run: `cd public-site && npx tsc --noEmit -p .`
Expected: exit code 0, no output. (`Services.tsx` and `BookingWidget.tsx` use `service.id`/`service.name`, which still exist; the added required fields are produced by the query.)

- [ ] **Step 4: Commit**

```bash
git add public-site/lib/data.ts
git commit -m "feat(public-site): show only public services, ordered by display_order"
```

---

### Task 3: Admin curation controls for services

**Files:**
- Modify: `index.html` — services table render (lines 2364-2369)
- Modify: `index.html` — add `saveService()` near `saveMaster()` (after line 2847)

- [ ] **Step 1: Replace the services table render with curation controls**

In `index.html`, replace lines 2364-2369:

```javascript
  document.getElementById('servicesTable').innerHTML = state.services.length === 0
    ? '<tr><td colspan="2" class="empty-msg">Нет услуг</td></tr>'
    : state.services.map(s => `<tr>
        <td>${s.name}</td>
        <td><button class="btn btn-danger btn-sm" onclick="delService(${s.id})">X</button></td>
      </tr>`).join('');
```

with:

```javascript
  document.getElementById('servicesTable').innerHTML = state.services.length === 0
    ? '<tr><td colspan="4" class="empty-msg">Нет услуг</td></tr>'
    : state.services.map(s => `<tr>
        <td style="vertical-align:middle;">${escapeText(s.name)}</td>
        <td style="vertical-align:middle;">
          <label style="display:flex; align-items:center; gap:6px; font-size:12px; color:var(--ink);">
            <input type="checkbox" id="servicePublic_${s.id}" ${s.is_public !== false ? 'checked' : ''}>
            Показывать на сайте
          </label>
        </td>
        <td style="vertical-align:middle;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="font-size:11px; color:var(--muted);">Порядок:</span>
            <input type="number" id="serviceOrder_${s.id}" value="${s.display_order ?? 100}" style="width:60px;">
          </div>
        </td>
        <td style="vertical-align:middle; text-align:right; white-space:nowrap;">
          <button class="btn btn-primary btn-sm" onclick="saveService(${s.id})">Сохранить</button>
          <button class="btn btn-danger btn-sm" onclick="delService(${s.id})">X</button>
        </td>
      </tr>`).join('');
```

- [ ] **Step 2: Update the services table header to match the new columns**

In `index.html`, replace line 1488:

```html
      <thead><tr><th>Услуга</th><th></th></tr></thead>
```

with:

```html
      <thead><tr><th>Услуга</th><th>Видимость</th><th>Порядок</th><th></th></tr></thead>
```

- [ ] **Step 3: Add the `saveService` function**

In `index.html`, immediately after the `saveMaster` function (after line 2847, the closing `}`), add:

```javascript
async function saveService(id) {
  const display_order = parseInt(val('serviceOrder_' + id), 10);
  const is_public = $('servicePublic_' + id).checked;

  const { error } = await sb.from('services').update({
    display_order, is_public
  }).eq('id', id);

  if (error) { toast(error.message, true); return; }
  toast('Сохранено');
  await loadAll();
}
```

- [ ] **Step 4: Verify the new symbols are wired and balanced (static check)**

Run: `grep -n "saveService\|servicePublic_\|serviceOrder_" index.html`
Expected: `saveService` appears in both the row's `onclick="saveService(${s.id})"` and the `async function saveService(id)` definition; `servicePublic_`/`serviceOrder_` each appear in both the render (input `id=`) and inside `saveService` (the `val(...)`/`$(...)` reads).

Run: `node --check index.html 2>&1 || echo "node --check does not parse HTML; skip"`
Expected: either passes or prints the skip note — this is HTML, so the real check is the manual one below. (`escapeText`, `val`, `$`, `toast`, `loadAll`, `sb` are all existing globals already used by `saveMaster`/`delService`.)

- [ ] **Step 5: Manual verification in the admin**

Open `index.html` in the browser (or the deployed admin), go to the **Мастера/Услуги** section:
1. Confirm each service row shows the name, a "Показывать на сайте" checkbox (checked), a "Порядок" number input (100), a "Сохранить" button, and the "X" delete button.
2. Toggle a service's checkbox off, change its order to e.g. `10`, click **Сохранить** → toast "Сохранено".
3. Reload the page → the checkbox stays off and the order stays `10` (proves the update persisted).
4. Re-check the box and save to restore, if desired.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(admin): curate services visibility + order"
```

---

### Task 4: End-to-end verification on the public site

**Files:** none (verification only)

- [ ] **Step 1: Verify hidden + ordering on the public site**

After Tasks 1-3 are deployed (Vercel rebuilds the public site on push):
1. In the admin, hide one service and set distinct orders on two others; save each.
2. Open the public site `#services` section → confirm the hidden service is **absent** from the price list, and the two reordered services appear in `display_order` order.
3. Open the `#booking` form → open the **Услуга** dropdown → confirm the hidden service is **absent** there too (same `getServices()` source).
4. In the admin, create a new service via "Добавить услугу" → confirm it appears on the site by default (defaults to `is_public = true`).

- [ ] **Step 2: Restore any test changes**

Re-enable any service you hid for testing and reset orders as the salon wants them.

---

## Self-Review

**Spec coverage:**
- Goal 1 (hide/show) → Task 1 column + Task 3 checkbox + Task 2 filter. ✓
- Goal 2 (manual order) → Task 1 column + Task 3 number input + Task 2 `order=`. ✓
- Goal 3 (hidden gone from both list AND booking) → Task 2 single `getServices()` filter feeds both; verified in Task 4 Step 1.3. ✓
- Goal 4 (no regression / existing stay visible) → `is_public default true` in Task 1; verified Task 1 Step 4 + Task 4 Step 1.4. ✓
- Non-goal "no new view" → Task 2 reads the `services` table directly with a filter, no view created. ✓

**Placeholder scan:** No TBD/TODO; every code step shows full code. ✓

**Type consistency:** `Service` gains `display_order: number` + `is_public: boolean` (Task 2 Step 1), consistent with the query in Step 2 and the admin reads `s.display_order`/`s.is_public` (Task 3 Step 1). Admin write `saveService` updates `{ display_order, is_public }` matching the column names. `servicePublic_${id}` / `serviceOrder_${id}` ids are identical in the render and in `saveService`. ✓
