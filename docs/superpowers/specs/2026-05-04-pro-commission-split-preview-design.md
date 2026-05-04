# Pro — Commission split preview ("Мастеру / Салону")

**Date:** 2026-05-04
**Surface:** `register.html` (master self-service, `nicole-salon-pro.vercel.app`)
**Backend impact:** none — read-only addition of a column already present in `master_services`.
**Visual reference:** `.superpowers/brainstorm/44352-1777854785/content/preview-split-v1.html` (approved during brainstorming — has the exact CSS for `.split-preview` and the right-side mirroring via `flex-direction: row-reverse`).

## Problem

The toggle "Продукты салона: Нет / Да" determines which commission rate applies (higher when the master uses her own products, lower when she uses salon-provided products). The toggle exists in two places — the main "выполненная работа" card and the inline self-complete form on upcoming appointments. In both places the master flips the toggle blind: she does not see how the choice affects what she takes home until after she taps "Записать" and reads the toast.

## Goal

Render a live, two-sided split — what the **master** earns and what the **salon** earns — directly under the Нет/Да toggle, recomputed in real time as the master selects a service, edits the price, or taps the toggle.

## Visual contract

A single line below the seg-radio:

```
Мастеру  50%  1 750 ₽    │    Салону  50%  1 750 ₽
```

- Two columns split 1fr / 1fr by a thin vertical hairline (`var(--hairline)`).
- Left side ("Мастеру") in `var(--accent-deep)` so the master's eye lands there first; right side ("Салону") in `var(--ink-soft)` / `var(--muted)`.
- Role label uppercase 9px with letter-spacing `.26em`.
- Percent in DM Sans 11px, tabular numerals.
- Value in Cormorant Garamond 19px, weight 500, tabular numerals, formatted as `<n> ₽` with thousands separator (reuses existing `fmt()` helper).
- Visible only when **service is selected AND price > 0**. Otherwise `hidden`.
- No animation, no fade — instantaneous update.

The same block appears in two places:

1. **Entry card** ("выполненная работа") — single instance with id `splitPreview`, after the `seg-radio[name="prodSrc"]`.
2. **Self-complete form** (one per upcoming appointment) — instance with id `splitPreview-${appointmentId}`, after the `seg-radio[name="selfProd-${id}"]`.

## Data contract

`loadServicesForMaster()` (currently `register.html:867`) extends its SELECT to include `commission_master_pct_salon`:

```js
.select('service_id, price, commission_master_pct, commission_master_pct_salon, services!inner(name)')
```

Each item in `state.masterServices` gains a numeric `commission_master_pct_salon` field. The column already exists (migration 004). RLS already permits reads for the anon key.

Backend is **not** touched. The server (`api/attendance.js`, `api/appointment.js?action=complete`) remains the source of truth for the actual `master_pay` written to `attendances`. The preview is purely informational; on save, the toast confirms with the server-computed value.

## Calculation

Pure function:

```js
function computeSplit(serviceId, price, usesSalon, masterServices) {
  if (!serviceId || !(price > 0)) return null;
  const ms = masterServices.find(x => x.service_id === serviceId);
  if (!ms) return null;
  const masterPct = usesSalon
    ? ms.commission_master_pct_salon
    : ms.commission_master_pct;
  const masterPay = Math.round(price * masterPct / 100);
  const salonPay  = Math.round(price - masterPay);
  const salonPct  = Math.round((100 - masterPct) * 100) / 100;
  return { masterPct, masterPay, salonPct, salonPay };
}
```

**Why `salonPay = price − masterPay` instead of `price × (100 − pct) / 100`:** subtraction guarantees `masterPay + salonPay === price` even after independent rounding of each side. Mirrors the server's authoritative computation.

## Edge cases

| Case | Behavior |
|---|---|
| No service selected | Preview hidden |
| Price empty or 0 | Preview hidden |
| `master_services` still loading | Preview hidden until loaded |
| Salon rate equals own rate | Preview shown anyway — redundancy is acceptable, reinforces transparency |
| `commission_master_pct_salon = 0` | Renders `Мастеру 0% · 0 ₽` / `Салону 100% · <price> ₽` without special warning |
| Master toggles, edits price, changes service | Recomputes on each event (`change` of service select, `input` of price field, `change` of prodSrc radios) |
| 320px viewport | Split 1fr/1fr fits; Cormorant 19px stays legible — no media query needed |
| Master not assigned to a service | Service does not appear in dropdown (existing behavior); preview never sees a missing row |

## Files touched

Single file: `register.html`.

```
register.html
├── <style>
│   └── New CSS: .split-preview, .split-side(.left|.right|.master),
│                .split-role, .split-pct-val, .split-pct, .split-val
│
├── <script>
│   ├── computeSplit(serviceId, price, usesSalon, masterServices)   ← new helper
│   ├── renderSplitPreview(targetEl, split)                         ← new helper
│   ├── loadServicesForMaster()  — SELECT adds commission_master_pct_salon
│   │                              and the map() preserves the new field
│   │
│   ├── refreshEntryPreview()                                       ← new
│   │     • bound to onServiceChange()
│   │     • bound to entryPrice 'input'
│   │     • bound to prodOwn/prodSalon 'change'
│   │
│   ├── renderUpcoming() — inserts <div id="splitPreview-${id}" hidden>
│   │                     after the selfProd seg-radio in each <li>
│   │
│   └── refreshSelfPreview(id)                                      ← new
│         • called once after appendChild during render (uses default
│           selfFinalPrice = a.estimated_price)
│         • bound to selfFinalPrice-${id} 'input'
│         • bound to selfProdOwn-${id} / selfProdSalon-${id} 'change'
│
└── HTML
    ├── Entry card: insert <div id="splitPreview" class="split-preview" hidden>
    │               after the seg-radio block (around line 711)
    └── renderUpcoming() template: insert per-appointment preview <div>
                                   after the selfProd seg-radio
```

Backend, schema, and admin pages: untouched.

## Verification

1. Log in as a master with at least one `master_services` row where the two rates differ (e.g. 50 / 40).
2. Open the entry card — preview hidden until a service is picked. ✓
3. Pick a service — price auto-fills, preview appears showing `Мастеру X% · Y ₽` / `Салону …`.
4. Edit price manually — both sides recompute, sum equals price.
5. Tap `Да` — master percentage drops to the salon rate, salon percentage rises; tap `Нет` — reverts.
6. Tap `Записать` — server toast "Записано. Моё: Y ₽" matches the `Мастеру` value shown.
7. Open "Календарь записей клиентов" → tap `Выполнено` on an appointment — same preview behavior inside the inline form. Final price defaults to `estimated_price`; preview reflects it immediately.
8. Edge: pick a service whose two rates are equal — preview still shows symmetric values.

## Out of scope

- Admin-side preview when configuring rates in the "Цены и комиссии" tab.
- Historical reconciliation in the "История" card (already shows server-stored `master_pay`).
- Animations / transitions.
- Tooltip explaining what "Продукты салона" means — the form context is already clear to masters who use it daily.
