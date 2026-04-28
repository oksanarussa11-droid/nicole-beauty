# Finance Clarity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make per-master daily revenue inspectable inline (Записи + Отчёты), and surface the salon's full P&L on Финансы (gross service revenue → master commissions → other expenses → net), removing the manual cross-tab arithmetic the admin does today.

**Architecture:** All changes are client-side in [index.html](index.html). No DB schema changes. Service revenue and commissions are derived from the existing `unifiedTotals(filterFn)` helper (line 1689) which already de-dupes between `state.daySummaries` and `state.attendances`. Two new render helpers handle expansion state via per-table in-memory `Set<master_id>`.

**Tech Stack:** Single-file vanilla JS + Supabase JS client. No test framework — verification is manual via browser (Safari against `nicole-beauty.vercel.app` or local file). All edits go in `index.html`.

**Spec:** [docs/superpowers/specs/2026-04-28-finance-clarity-design.md](../specs/2026-04-28-finance-clarity-design.md)

## File Structure

Only one file is touched: [index.html](index.html). Sections affected:

- `renderOperational()` near line 2095 — `monthReport` table gets per-master expansion
- `renderReports()` near line 2241 — master breakdown table gets per-master expansion
- `renderFinance()` near line 2130 — replaces 4-card row with salon P&L cards + adds breakdown line
- `#incCat` dropdown at line 1363 — reorder options (Прочее first), add hint to Услуги option
- `setVal('incDate', today())` area near 2736 — set default category to `Прочее`
- New module-scoped state for expansion sets, near top of script block

A small CSS rule for child rows is added inline in the existing `<style>` block.

---

## Task 1: Add expansion-state holders and a shared helper for per-master daily aggregation

**Files:**
- Modify: [index.html](index.html) — add to the `state` block (around line 1577 where `state` is declared) and add a new helper after `unifiedTotals` (around line 1722).

- [ ] **Step 1: Locate the `state` object**

Search [index.html](index.html) for `expenses: [],` — that anchors the state object initializer.

- [ ] **Step 2: Add expansion sets to `state`**

Inside the `state = { ... }` object literal, add two new keys (place them near the end of the object, before the closing `}`):

```js
  // UI-only: which master rows are expanded in the per-master tables.
  // Keyed by master_id (number). Not persisted across reloads.
  uiExpandedMonth: new Set(),
  uiExpandedReport: new Set(),
```

- [ ] **Step 3: Add helper `unifiedByMasterDay`**

Immediately after the existing `unifiedTotals` function (the line that currently reads `}` closing `unifiedTotals` near line 1722), insert:

```js
// Returns Map<master_id, Array<{date, revenue, master_pay}>> for the given filterFn.
// Sorted by date ascending within each master. Reuses unifiedTotals so OCR day-summaries
// and per-form attendances stay de-duplicated the same way as the parent rollup.
function unifiedByMasterDay(filterFn) {
  const rows = unifiedTotals(filterFn);
  const m = new Map();
  for (const r of rows) {
    if (!m.has(r.master_id)) m.set(r.master_id, []);
    m.get(r.master_id).push({ date: r.date, revenue: r.revenue, master_pay: r.master_pay });
  }
  for (const arr of m.values()) arr.sort((a, b) => a.date.localeCompare(b.date));
  return m;
}
```

- [ ] **Step 4: Verify nothing broke**

Open [index.html](index.html) in a browser, log in as admin, navigate through every tab. No console errors. All existing tables and stats render the same as before.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(panel): add per-master daily aggregation helper and expansion state"
```

---

## Task 2: Add CSS for expandable rows

**Files:**
- Modify: [index.html](index.html) — extend the existing `<style>` block.

- [ ] **Step 1: Find the table-related CSS**

Search [index.html](index.html) for `table th` inside the `<style>` block — that's the table styling region.

- [ ] **Step 2: Append rules**

Add the following rules at the end of the `<style>` block (just before `</style>`):

```css
.row-expand { cursor: pointer; }
.row-expand .expand-caret {
  display: inline-block;
  width: 14px;
  color: var(--muted, #888);
  font-size: 12px;
  vertical-align: 1px;
  transition: transform .15s ease;
}
.row-child td {
  background: rgba(0,0,0,.025);
  font-size: 12px;
  color: var(--muted, #555);
  border-top: none;
}
.row-child td:first-child { padding-left: 28px; }
```

- [ ] **Step 3: Verify**

Reload the panel in the browser. Existing tables still look correct (no visual regressions from new rules, which target classes that aren't yet rendered).

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(panel): styles for expandable per-master rows"
```

---

## Task 3: Per-day breakdown in "Итог за период" (Записи tab)

**Files:**
- Modify: [index.html](index.html) — `renderOperational` near line 2095 (the `monthReport` block).

- [ ] **Step 1: Locate the `monthReport` rendering block**

In `renderOperational()`, find the block that starts with `const masters = Object.entries(masterMap);` and ends with the line that sets `mr.innerHTML` to the totals row. Currently around lines 2105–2120.

- [ ] **Step 2: Replace the rendering block**

Replace the block from `const masters = Object.entries(masterMap);` through its closing `}` (the one that follows the inner `else` branch — keep the outer `}` of `renderOperational`) with:

```js
  // Build a list of [master_id, name, m] so we can key expansions by id, not name.
  const masterRows = [];
  unified.forEach(d => {
    let row = masterRows.find(r => r.id === d.master_id);
    if (!row) {
      row = { id: d.master_id, name: masterName(d.master_id), days: new Set(), revenue: 0, payout: 0 };
      masterRows.push(row);
    }
    row.days.add(d.date);
    row.revenue += d.revenue;
    row.payout  += d.master_pay;
  });
  const dayMap = unifiedByMasterDay(pick);
  const mr = document.getElementById('monthReport');
  if (masterRows.length === 0) {
    mr.innerHTML = '<tr><td colspan="5" class="empty-msg">Нет данных</td></tr>';
  } else {
    const parts = [];
    for (const r of masterRows) {
      const open = state.uiExpandedMonth.has(r.id);
      const caret = open ? '<i class="ph-light ph-caret-down expand-caret"></i>' : '<i class="ph-light ph-caret-right expand-caret"></i>';
      parts.push(`<tr class="row-expand" onclick="toggleMonthExpand(${r.id})">
        <td>${caret} ${r.name}</td>
        <td style="text-align:center">${r.days.size}</td>
        <td>${fmt(r.revenue)}</td>
        <td>${fmt(r.payout)}</td>
        <td>${fmt(r.revenue - r.payout)}</td>
      </tr>`);
      if (open) {
        const days = dayMap.get(r.id) || [];
        for (const d of days) {
          parts.push(`<tr class="row-child">
            <td>${fmtDate(d.date)}</td>
            <td></td>
            <td>${fmt(d.revenue)}</td>
            <td>${fmt(d.master_pay)}</td>
            <td>${fmt(d.revenue - d.master_pay)}</td>
          </tr>`);
        }
      }
    }
    parts.push(`<tr style="font-weight:bold;background:#f8f4f7">
      <td>ИТОГО</td>
      <td style="text-align:center">${masterRows.reduce((s, r) => s + r.days.size, 0)}</td>
      <td>${fmt(masterRows.reduce((s, r) => s + r.revenue, 0))}</td>
      <td>${fmt(masterRows.reduce((s, r) => s + r.payout, 0))}</td>
      <td>${fmt(masterRows.reduce((s, r) => s + r.revenue - r.payout, 0))}</td>
    </tr>`);
    mr.innerHTML = parts.join('');
  }
```

- [ ] **Step 3: Add the toggle handler**

Add this function in the same script block, near the other render helpers (e.g., immediately after `renderOperational`'s closing `}`):

```js
window.toggleMonthExpand = function(masterId) {
  const s = state.uiExpandedMonth;
  if (s.has(masterId)) s.delete(masterId); else s.add(masterId);
  renderOperational();
};
```

- [ ] **Step 4: Verify in browser**

1. Reload the admin panel.
2. Open the Записи tab; pick a month with data (e.g., `2026-04`).
3. Each master row in "Итог за период" shows a `▸` caret. Click on a master row.
4. The caret flips to `▾` and child rows appear below — one per active day, with Дата · Выручка · Мастеру · Салону.
5. Click again — collapses. Filter the month — expansion state persists for masters still present, drops for those not.
6. Sum of expanded child rows equals the parent row totals.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(panel): per-day breakdown for Итог за период (Записи)"
```

---

## Task 4: Per-day breakdown in master table (Отчёты tab)

**Files:**
- Modify: [index.html](index.html) — `renderReports` near line 2241.

- [ ] **Step 1: Locate the master table rendering**

In `renderReports()`, find the block:

```js
  const mEntries = Object.entries(masterMap);
```

…through the table that ends `</table>\``. Currently around lines 2248–2267.

- [ ] **Step 2: Replace the master aggregation and table block**

Replace from `const masterMap = {};` through the closing backtick of the master table template (the line ending `</table>\`;` after the `mEntries.map` row) with:

```js
  const masterRows = [];
  unified.forEach(d => {
    let row = masterRows.find(r => r.id === d.master_id);
    if (!row) {
      row = { id: d.master_id, name: masterName(d.master_id), revenue: 0, payout: 0 };
      masterRows.push(row);
    }
    row.revenue += d.revenue;
    row.payout  += d.master_pay;
  });
  const maxVal = Math.max(1, ...masterRows.map(r => r.revenue));
  const dayMap = unifiedByMasterDay(pick);

  document.getElementById('chartMasters').innerHTML = masterRows.length === 0
    ? '<div class="empty-msg">Нет данных</div>'
    : `<div class="chart-bar-container">
        ${masterRows.map(r => `
          <div class="chart-bar-group">
            <div class="chart-bars">
              <div class="chart-bar revenue" style="height:${(r.revenue/maxVal)*140}px;" title="${fmt(r.revenue)}"></div>
              <div class="chart-bar payout"  style="height:${(r.payout/maxVal)*140}px;"  title="${fmt(r.payout)}"></div>
              <div class="chart-bar salon"   style="height:${((r.revenue-r.payout)/maxVal)*140}px;" title="${fmt(r.revenue-r.payout)}"></div>
            </div>
            <div class="chart-bar-label">${r.name}</div>
          </div>`).join('')}
      </div>
      <table style="margin-top:10px;">
        <tr><th>Мастер</th><th>Выручка</th><th>Мастеру</th><th>Салону</th></tr>
        ${masterRows.map(r => {
          const open = state.uiExpandedReport.has(r.id);
          const caret = open ? '<i class="ph-light ph-caret-down expand-caret"></i>' : '<i class="ph-light ph-caret-right expand-caret"></i>';
          const head = `<tr class="row-expand" onclick="toggleReportExpand(${r.id})">
            <td>${caret} ${r.name}</td>
            <td>${fmt(r.revenue)}</td>
            <td>${fmt(r.payout)}</td>
            <td>${fmt(r.revenue - r.payout)}</td>
          </tr>`;
          if (!open) return head;
          const days = dayMap.get(r.id) || [];
          const child = days.map(d => `<tr class="row-child">
            <td>${fmtDate(d.date)}</td>
            <td>${fmt(d.revenue)}</td>
            <td>${fmt(d.master_pay)}</td>
            <td>${fmt(d.revenue - d.master_pay)}</td>
          </tr>`).join('');
          return head + child;
        }).join('')}
      </table>`;
```

Note: the previous code used `mEntries`, which is no longer defined. Search the rest of `renderReports` for any other references to `mEntries` and replace them with `masterRows` if found.

- [ ] **Step 3: Add toggle handler**

Add near the other handlers (e.g., after `renderReports`):

```js
window.toggleReportExpand = function(masterId) {
  const s = state.uiExpandedReport;
  if (s.has(masterId)) s.delete(masterId); else s.add(masterId);
  renderReports();
};
```

- [ ] **Step 4: Verify**

1. Open Отчёты tab with a populated date range.
2. Master table rows show `▸` caret; clicking expands per-day child rows.
3. Bar chart unchanged.
4. Sums of child rows match parent.
5. No console errors; no reference to `mEntries` left in the file (`grep -n mEntries index.html` returns nothing).

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "feat(panel): per-day breakdown for master table (Отчёты)"
```

---

## Task 5: Reorder Услуги option and adjust default in Доходы form

**Files:**
- Modify: [index.html](index.html) — line 1363 (`#incCat`) and line ~2736 (`setVal('incDate', today())`).

- [ ] **Step 1: Update the dropdown**

Replace the `#incCat` line:

```html
        <select id="incCat"><option>Услуги</option><option>Аренда (субаренда)</option><option>Продажа товаров</option><option>Прочее</option></select>
```

with:

```html
        <select id="incCat">
          <option value="Прочее">Прочее</option>
          <option value="Аренда (субаренда)">Аренда (субаренда)</option>
          <option value="Продажа товаров">Продажа товаров</option>
          <option value="Услуги" title="Ручная запись — обычно учитывается автоматически">Услуги (ручная)</option>
        </select>
```

The first option becomes the default. The Услуги label is annotated to make the override intent visible at the point of entry. `value="Услуги"` keeps the stored category string identical so existing rows and downstream logic (CSV export, etc.) are unaffected.

- [ ] **Step 2: Verify**

Open Финансы. The form's category dropdown defaults to `Прочее`. Clicking the dropdown shows `Услуги (ручная)` as the last option with a tooltip on hover.

Add a test income with category `Прочее` — it appears in the Доходы table with category `Прочее`. Add another with `Услуги (ручная)` — it appears with category `Услуги` (the stored value). Delete both.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(panel): default income category to Прочее; mark Услуги as manual override"
```

---

## Task 6: Salon-consolidated cards on ФИНАНСЫ

**Files:**
- Modify: [index.html](index.html) — `renderFinance` near line 2130.

- [ ] **Step 1: Replace the body of `renderFinance`**

Find `function renderFinance() {` and replace its entire body (through the closing `}` of `renderFinance`, currently around line 2162) with:

```js
function renderFinance() {
  const month = val('finMonth');
  const incF = state.income.filter(i => matchMonth(i.date, month));
  const expF = state.expenses.filter(e => matchMonth(e.date, month));

  // Service revenue + master commissions come from unifiedTotals (single source of truth).
  const unified = unifiedTotals(d => matchMonth(d, month));
  const svcRev    = unified.reduce((s, d) => s + d.revenue, 0);
  const masterPay = unified.reduce((s, d) => s + d.master_pay, 0);

  // Manual income (any category, including Услуги override) is supplementary.
  const otherInc = incF.reduce((s, i) => s + Number(i.amount), 0);
  const totalExp = expF.reduce((s, e) => s + Number(e.amount), 0);
  const unpaid   = expF.filter(e => e.status === 'Не оплачено').reduce((s, e) => s + Number(e.amount), 0);

  const netSalon = (svcRev - masterPay) + otherInc - totalExp;

  document.getElementById('finStats').innerHTML = `
    <div class="stat-card green"><div class="stat-label">Выручка услуг</div><div class="stat-value">${fmt(svcRev)}</div></div>
    <div class="stat-card orange"><div class="stat-label">Комиссии мастерам</div><div class="stat-value">${fmt(masterPay)}</div></div>
    <div class="stat-card red"><div class="stat-label">Прочие расходы</div><div class="stat-value">${fmt(totalExp)}${unpaid ? ` <span style="font-size:11px;color:var(--muted,#888);font-weight:normal">(не оплачено: ${fmt(unpaid)})</span>` : ''}</div></div>
    <div class="stat-card"><div class="stat-label">Чистая прибыль</div><div class="stat-value">${fmt(netSalon)}</div></div>
  `;

  // Explicit arithmetic line so any manual income is visibly additive, not silently merged.
  const calcLine = document.getElementById('finCalcLine');
  if (calcLine) {
    calcLine.innerHTML = `
      <span>Выручка ${fmt(svcRev)}</span>
      <span class="op">−</span>
      <span>Комиссии ${fmt(masterPay)}</span>
      <span class="op">=</span>
      <span><strong>К зачислению ${fmt(svcRev - masterPay)}</strong></span>
      <span class="op">+</span>
      <span>Прочие доходы ${fmt(otherInc)}</span>
      <span class="op">−</span>
      <span>Прочие расходы ${fmt(totalExp)}</span>
      <span class="op">=</span>
      <span><strong>Чистая прибыль ${fmt(netSalon)}</strong></span>
    `;
  }

  document.getElementById('incTable').innerHTML = incF.length === 0
    ? '<tr><td colspan="6" class="empty-msg">Нет доходов</td></tr>'
    : incF.map(i => `<tr>
        <td>${fmtDate(i.date)}</td><td>${i.category}</td><td>${i.description||''}</td>
        <td>${fmt(i.amount)}</td><td>${i.method||''}</td>
        <td><button class="btn btn-danger btn-sm" onclick="delInc(${i.id})">X</button></td>
      </tr>`).join('');

  document.getElementById('expTable').innerHTML = expF.length === 0
    ? '<tr><td colspan="7" class="empty-msg">Нет расходов</td></tr>'
    : expF.map(e => `<tr>
        <td>${fmtDate(e.date)}</td><td>${e.category}</td><td>${e.description||''}</td>
        <td>${fmt(e.amount)}</td><td>${e.supplier||''}</td>
        <td><span class="badge ${e.status === 'Оплачено' ? 'badge-paid' : 'badge-unpaid'}">${e.status}</span></td>
        <td><button class="btn btn-danger btn-sm" onclick="delExp(${e.id})">X</button></td>
      </tr>`).join('');
}
```

- [ ] **Step 2: Verify in browser**

1. Open Финансы for a populated month.
2. The four cards now read: `Выручка услуг`, `Комиссии мастерам`, `Прочие расходы`, `Чистая прибыль`.
3. With the screenshot example data (Ирина 2 950 + Людмила 19 515 + isolated solarium attendances), `Выручка услуг` should match the ИТОГО of "Итог за период" on the Записи tab for the same month.
4. `Комиссии мастерам` matches the ИТОГО "Мастеру" column.
5. `Прочие расходы` matches the previous `Расходы` card; if any expenses are unpaid, the small `(не оплачено: ...)` annotation appears beneath the value.
6. The breakdown line container is empty for now — that's expected (added in next task).

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "feat(panel): salon-consolidated P&L cards on Финансы"
```

---

## Task 7: Add the explicit arithmetic line below the Финансы cards

**Files:**
- Modify: [index.html](index.html) — `#finance` section markup near line 1356, and `<style>` block.

- [ ] **Step 1: Add CSS for the line**

Append to the `<style>` block (right after the rules added in Task 2):

```css
.calc-line {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 12px;
  align-items: baseline;
  font-size: 13px;
  color: var(--text, #333);
  margin: 4px 0 14px 0;
  padding: 10px 14px;
  background: rgba(0,0,0,.02);
  border-left: 2px solid var(--accent, #B89882);
  letter-spacing: .02em;
}
.calc-line .op { color: var(--muted, #888); font-weight: 300; }
.calc-line strong { font-weight: 600; }
```

- [ ] **Step 2: Add the container element**

In the `#finance` section, immediately after the `<div class="stats" id="finStats"></div>` line (around line 1356), add:

```html
  <div class="calc-line" id="finCalcLine"></div>
```

- [ ] **Step 3: Verify**

1. Reload Финансы. Below the four cards, a single horizontal line shows the full arithmetic in plain words.
2. Example layout: `Выручка 22 465 ₽ − Комиссии 10 277 ₽ = К зачислению 12 188 ₽ + Прочие доходы 0 ₽ − Прочие расходы 1 754 ₽ = Чистая прибыль 10 434 ₽`.
3. The `Чистая прибыль` value in the line equals the `Чистая прибыль` card.
4. Add a manual income (e.g., 1 000 ₽ Прочее) — the `Прочие доходы` segment in the line bumps to 1 000 ₽ and `Чистая прибыль` increases by 1 000 ₽. Delete the test row.
5. Resize the window — line wraps gracefully.

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "feat(panel): explicit arithmetic breakdown line on Финансы"
```

---

## Task 8: Final cross-tab sanity check

- [ ] **Step 1: End-to-end verification**

For a populated month (e.g., `2026-04`):

1. **Записи tab** — note the ИТОГО row of "Итог за период": `Выручка = A`, `Мастеру = B`, `Салону = C` (where `C = A − B`).
2. **Отчёты tab** — same date range — master breakdown ИТОГО: `Выручка = A`, `Мастеру = B`, `Салону = C`. (Match.)
3. **Финансы tab** — same month — `Выручка услуг = A`, `Комиссии мастерам = B`. The `К зачислению` segment of the calc line equals `C`.
4. Add 100 ₽ to `Прочие` income; `Чистая прибыль = (A − B) + 100 − totalExp`. Delete the test row.
5. Expand a master in Записи — child rows sum to that master's parent row. Same in Отчёты.
6. No console errors anywhere.

- [ ] **Step 2: If all checks pass, do a final no-op commit to mark the milestone**

```bash
git commit --allow-empty -m "chore: finance clarity — cross-tab numbers reconciled"
```

---

## Self-Review Notes

- **Spec coverage:** Tasks 1, 3, 4 cover the per-day breakdown (spec §1). Tasks 5–7 cover the Финансы P&L and the dropdown change (spec §2 + "Default automatic, manual as override"). Task 8 verifies the cross-tab consistency the admin used to do on paper.
- **Placeholder scan:** all code blocks contain real code; no TBD/TODO; no "similar to Task N" shortcuts.
- **Type/name consistency:** `unifiedByMasterDay` defined in Task 1 is used in Tasks 3 and 4. `state.uiExpandedMonth` / `state.uiExpandedReport` defined in Task 1, consumed and toggled in Tasks 3 and 4. `toggleMonthExpand` / `toggleReportExpand` defined alongside their consumers. `#finCalcLine` element added in Task 7, consumed in Task 6 (consumer guards with `if (calcLine)` so order is safe even if Task 7 isn't done yet).
