# Finance Clarity — Per-Day Breakdown & Salon P&L

**Date:** 2026-04-28
**Scope:** `index.html` admin panel only. No DB schema changes.

## Problem

The administrator currently has to navigate between Записи / Отчёты / Финансы and add numbers on paper to get the salon's net result, because:

1. The "Итог за период" table (Записи) and the master breakdown table (Отчёты) summarize per master across the whole period. To audit a master's days, the admin must scroll the Журнал услуг and tally manually.
2. The Финансы tab only reads `income` / `expenses`. Master commissions and service revenue (which live in `attendances` / `day_totals` and feed `unifiedTotals`) never reach this tab, so the bottom-line number for the salon is invisible there.

## Goal

Surface data already in `state` so the admin sees, without leaving a tab:

- per-master daily detail on demand (collapsible),
- the full salon P&L on Финансы (gross service revenue → master commissions → other expenses → net profit).

## Changes

### 1. Per-day expansion in master summary tables

Two tables get the same treatment:

- **Записи → "Итог за период"** (`#monthReport`, rendered in `renderOperational`)
- **Отчёты → master breakdown** (the table at line ~2265 in `renderReports`)

Behavior:

- Each master row gets a leading caret (`▸` collapsed / `▾` expanded) and becomes clickable.
- Click toggles a set of child rows — one per distinct date that master had activity in the current period — aggregated from `unifiedTotals` (same source already feeding the parent summary).
- Child row columns mirror the parent: Дата · Выручка · Мастеру · Салону. The "Дней" column on the Записи variant is omitted on child rows (or shown blank).
- Default: **collapsed**. Expansion state lives in a per-table in-memory `Set<master_id>`; not persisted across reloads.
- The ИТОГО row stays non-expandable.
- Re-renders (filter changes, data reloads) preserve the open set if the master still appears; otherwise the entry is dropped.

Styling: child rows use a lightly tinted background (`var(--surface-2)` or equivalent), slightly smaller font, no heavy borders — consistent with existing table aesthetic. The caret uses a Phosphor Light icon (`ph-caret-right` / `ph-caret-down`) to match the recent icon migration.

### 2. ФИНАНСЫ — consolidated salon P&L (option A)

`renderFinance()` is extended to also derive monthly service totals from `unifiedTotals(d => matchMonth(d, month))`.

The four-card row is **replaced** with the salon-consolidated view:

| Card | Source | Formula |
|---|---|---|
| Выручка услуг | unifiedTotals | Σ `revenue` |
| Комиссии мастерам | unifiedTotals | Σ `master_pay` |
| Прочие расходы | `state.expenses` | Σ `amount` (current `totalExp`) |
| Чистая прибыль | derived | `(Выручка услуг − Комиссии мастерам) + Прочие доходы − Прочие расходы` |

Where `Прочие доходы` = current `totalInc` from `state.income` (non-service income such as product sales / other categories).

A compact "Расчёт по салону" line is rendered below the cards, on a single row, showing the arithmetic explicitly:

> Выручка 22 465 ₽ − Комиссии 10 277 ₽ = К зачислению 12 188 ₽ + Прочие доходы X ₽ − Прочие расходы 1 754 ₽ = Чистая прибыль Y ₽

The "Не оплачено" indicator is preserved as a small inline badge inside the Расходы table area (or as a muted sub-line under the Прочие расходы card) — it stays visible but does not occupy a top-level card slot.

Доходы and Расходы tables below the cards are unchanged (they continue to manage `income` / `expenses` rows).

## Non-goals

- No DB schema changes.
- No changes to how attendances / day_totals are written.
- No changes to Reports tab math beyond the per-day expansion in the master breakdown table.
- No persistence of expansion state across page reloads.

## Default automatic, manual as override

Service revenue is automatically derived from `attendances` / `day_totals` via `unifiedTotals` — that is the default and the source of truth for `Выручка услуг`. Manual entry on the Доходы form remains available as an explicit override (e.g., a cash service paid directly at the desk that wasn't logged by a master).

To keep the two paths transparent and avoid silent double-counting:

- The `#incCat` dropdown keeps all current options, including `Услуги`. Default selection changes from `Услуги` to `Прочее`, signaling that the typical reason to use the form is non-service income.
- `Выручка услуг` card shows ONLY the unifiedTotals figure (single source).
- `Прочие доходы` card shows the sum of all `state.income` regardless of category — manual `Услуги` entries are treated as supplementary income, not folded into `Выручка услуг`.
- The "Расчёт по салону" line breaks the arithmetic out explicitly, so any manual `Услуги` row appears as a visible addition rather than getting silently merged. If the admin sees a `Прочие доходы` value larger than expected, the Доходы table below shows exactly which rows contributed.
- A small inline hint next to the `Услуги` option in the dropdown ("ручная запись — обычно учитывается автоматически") makes the intent clear at the point of entry.

This way the admin can override when needed, and the UI never hides where a number came from.

## Risks / edge cases

- `unifiedTotals` already de-duplicates between OCR day-summaries and per-form attendances; reusing it (rather than re-summing `state.attendances` directly) is required to avoid double-counting.
- A master with zero activity in the period must not render an empty expansion (the parent row simply won't be present).
- A manual `Услуги` row represents revenue the admin intentionally added on top of the masters' logs. It is reflected under `Прочие доходы` and visible in the breakdown line, so duplication (if it happens) is the admin's choice and is auditable.

## Files touched

- `index.html` — `renderOperational` (monthReport block), `renderReports` (master table block), `renderFinance`, plus a small expansion-state helper. No new files.
