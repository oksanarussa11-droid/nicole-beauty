# Services Curation — Manual Visibility & Ordering

**Date:** 2026-06-01
**Status:** Approved (design)
**Author:** Andrei + Claude

## Problem

On the public site, the services price list ([public-site/components/Services.tsx](../../../public-site/components/Services.tsx)) and the booking form dropdown ([public-site/components/BookingWidget.tsx](../../../public-site/components/BookingWidget.tsx)) both render **every** row in the `services` table, in the database's physical order. There is no way to:

- hide a service from the public site, or
- control the order services appear in.

The `services` table only has `id`, `name`, `created_at`, and the public query `services?select=*` has no `order=` clause, so ordering is undefined (effectively insertion order).

Masters already solved this exact problem: the `masters` table has `display_order` and `is_public`, edited in the admin, and the public site reads them filtered/ordered. This spec mirrors that pattern onto `services`.

## Goals

1. Salon staff can mark a service as shown/hidden on the public site.
2. Salon staff can set a manual ordering for services.
3. A hidden service disappears from **both** the public price list **and** the booking form dropdown.
4. No regression: all existing services stay visible after the change.

## Non-Goals

- Drag-and-drop reordering (use a number input, consistent with the masters UI).
- Per-service rich content (descriptions, photos, categories).
- Changing how prices are computed (`from` = min price among public masters stays as-is).
- Row-Level Security hardening for `services` (services carry no sensitive data; an anon client can already read the table).

## Design

Mirror the masters curation pattern 1:1.

### 1. Database — migration `supabase/migrations/010_services_curation.sql`

Idempotent, same style as [009_masters_public_fields.sql](../../../supabase/migrations/009_masters_public_fields.sql):

```sql
alter table services add column if not exists display_order int not null default 100;
alter table services add column if not exists is_public boolean not null default true;
```

- `is_public default true` → every existing service stays visible (no regression, Goal 4).
- `display_order default 100` → same convention as masters; ties broken by `name`.
- **No new view.** Unlike `masters` (where the `masters_public` view hides PIN/sensitive columns), `services` has nothing sensitive, so the public site keeps reading the `services` table directly — only adding a filter. This keeps the change minimal.

Also update the canonical [supabase/schema.sql](../../../supabase/schema.sql) `create table services (...)` block to include the two new columns, matching the migration (documentation/bootstrap parity, same as the masters precedent).

Migration is applied manually via Supabase → SQL Editor → RUN, per the repo convention documented in the project README.

### 2. Admin — [index.html](../../../index.html)

In the "Услуги" card, mirror the masters table controls.

- **Table rendering** (currently `state.services.map(...)` producing `<td>${s.name}</td>` + delete button): add two controls per row, styled like the masters row:
  - Checkbox `#servicePublic_${s.id}`, checked when `s.is_public !== false`, label **"Показывать на сайте"**.
  - Number input `#serviceOrder_${s.id}`, value `s.display_order ?? 100`, label **"Порядок"**.
  - A **"Сохранить"** button calling `saveService(s.id)`, placed next to the existing delete button.
- **New function `saveService(id)`** mirroring `saveMaster(id)`:

```javascript
async function saveService(id) {
  const display_order = parseInt(val('serviceOrder_' + id), 10);
  const is_public = $('servicePublic_' + id).checked;
  const { error } = await sb.from('services').update({ display_order, is_public }).eq('id', id);
  if (error) { toast(error.message, true); return; }
  toast('Сохранено');
  await loadAll();
}
```

- The existing services load (`sb.from('services').select('*')`) already returns the new columns once the migration runs — no change needed there.
- `addService()` is unchanged: new services inherit the DB defaults (`is_public = true`, `display_order = 100`).

### 3. Public site — [public-site/lib/data.ts](../../../public-site/lib/data.ts)

- Extend the `Service` type with `display_order: number` and `is_public: boolean`.
- Change `getServices()` query from `services?select=*` to:

  ```
  services?is_public=eq.true&order=display_order.asc,name.asc
  ```

- No change to `servicePrices()`, `Services.tsx`, or `BookingWidget.tsx`: `app/page.tsx` derives both the price list and the booking dropdown from the same `getServices()` result, so filtering once removes hidden services from both (Goal 3).

## Data Flow After Change

```
admin (index.html)
  └─ saveService(id) ──> services.update({ display_order, is_public })  [Supabase]
                                          │
public-site (server, app/page.tsx)        │ reads
  └─ getServices()  services?is_public=eq.true&order=display_order.asc,name.asc
        ├─ servicePrices(...) ──> <Services />        (price list)
        └─ services ───────────> <BookingWidget />    (booking dropdown)
```

## Resulting Behavior

- **Which appear:** only `is_public = true`.
- **Order:** `display_order` ascending, then `name` alphabetically as tiebreaker.
- A public service with no public-master price still renders as "по запросу" (current behavior preserved).

## Risks & Mitigations

- **Forgetting to run the migration before deploy** → public-site query filters on a non-existent column and errors. Mitigation: run migration in Supabase first, verify, then deploy the public-site query change. The admin UI change is harmless before the migration (the columns just read as undefined) but should also land after the migration.
- **anon write exposure**: `saveService` uses the anon key (same as `saveMaster` today). This is an existing property of the admin app, not introduced here; out of scope.

## Testing / Verification

1. Run migration in Supabase; confirm `services` has the two columns and existing rows are `is_public = true`, `display_order = 100`.
2. In the admin: toggle a service off, set orders, save; confirm values persist after reload.
3. On the public site (after deploy): confirm the hidden service is absent from both the price list and the booking dropdown, and that ordering matches `display_order`.
4. Confirm a brand-new service (via `addService`) appears as visible by default.
