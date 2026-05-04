# Pro Commission Split Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render a live "Мастеру / Салону" two-sided split (% + ₽) under the toggle "Продукты салона: Нет / Да" in [register.html](register.html), recomputed on every service / price / toggle change, in both the main entry card and the inline self-complete form on upcoming appointments.

**Architecture:** Single-file change in [register.html](register.html). Extend the existing `loadServicesForMaster()` SELECT to include `commission_master_pct_salon` (column already shipped in migration 004). Add a pure `computeSplit()` helper, a `renderSplitPreview(target, split)` DOM helper, and two thin glue functions (`refreshEntryPreview`, `refreshSelfPreview(id)`) bound to the relevant change/input events. Backend, schema, and other pages are untouched.

**Tech Stack:** Single-file vanilla JS + Supabase JS client. No test framework — verification is manual via browser (open `register.html` locally with a `config.js` pointing at the live Supabase project, or hit `nicole-salon-pro.vercel.app` after deploy).

**Spec:** [docs/superpowers/specs/2026-05-04-pro-commission-split-preview-design.md](../specs/2026-05-04-pro-commission-split-preview-design.md)

**Visual reference (mockup approved during brainstorming):** [.superpowers/brainstorm/44352-1777854785/content/preview-split-v1.html](../../../.superpowers/brainstorm/44352-1777854785/content/preview-split-v1.html) — has the exact CSS structure including the right-side `flex-direction: row-reverse` mirror.

## File Structure

Only [register.html](register.html) is touched. Sections affected (line numbers approximate, search by anchor):

- **CSS block** (after the `.seg-radio input[type="radio"]:checked+label` rule, ~line 259) — new `.split-preview` rules.
- **Entry card HTML** (after the `prodSrc` `<div class="seg-radio">` block, ~line 711) — new `<div id="splitPreview" class="split-preview" hidden>`.
- **`loadServicesForMaster()`** (~line 867) — SELECT and `map()` extended.
- **New helpers** (insert near other pure helpers — `escapeHtml` is at ~line 1186; place the new code just before that): `computeSplit`, `renderSplitPreview`.
- **`onServiceChange()`** (~line 1427) — call `refreshEntryPreview()`.
- **New helper** `refreshEntryPreview()` — placed adjacent to `onServiceChange`.
- **DOM bindings** — added in the `DOMContentLoaded` handler (~line 1489) for `entryPrice` `input` and `prodOwn`/`prodSalon` `change`.
- **`renderUpcoming()` template** (~line 947) — adds per-id `<div id="splitPreview-${id}" class="split-preview" hidden>` after the `seg-radio` and binds events after each render.
- **New helper** `refreshSelfPreview(id)` — placed adjacent to `submitSelfComplete`.

---

## Task 1: Extend `loadServicesForMaster` to fetch the salon-products commission rate

**Files:**
- Modify: [register.html](register.html) — `loadServicesForMaster()` around lines 867–885.

- [ ] **Step 1: Locate the function**

Search [register.html](register.html) for `async function loadServicesForMaster(`. The current body is:

```js
async function loadServicesForMaster(masterId) {
  const { data, error } = await sb
    .from('master_services')
    .select('service_id, price, commission_master_pct, services!inner(name)')
    .eq('master_id', masterId);
  if (error) throw error;
  state.masterServices = (data || []).map(r => ({
    service_id: r.service_id,
    price: Number(r.price) || 0,
    commission_master_pct: Number(r.commission_master_pct) || 0,
    service_name: r.services?.name || ('#' + r.service_id),
  })).sort((a, b) => a.service_name.localeCompare(b.service_name, 'ru'));

  const sel = $('entryService');
  sel.innerHTML = '<option value="">—</option>' +
    state.masterServices.map(ms =>
      `<option value="${ms.service_id}" data-price="${ms.price}">${escapeHtml(ms.service_name)}</option>`
    ).join('');
}
```

- [ ] **Step 2: Add `commission_master_pct_salon` to the SELECT and map**

Replace the function body with:

```js
async function loadServicesForMaster(masterId) {
  const { data, error } = await sb
    .from('master_services')
    .select('service_id, price, commission_master_pct, commission_master_pct_salon, services!inner(name)')
    .eq('master_id', masterId);
  if (error) throw error;
  state.masterServices = (data || []).map(r => ({
    service_id: r.service_id,
    price: Number(r.price) || 0,
    commission_master_pct: Number(r.commission_master_pct) || 0,
    commission_master_pct_salon: Number(r.commission_master_pct_salon) || 0,
    service_name: r.services?.name || ('#' + r.service_id),
  })).sort((a, b) => a.service_name.localeCompare(b.service_name, 'ru'));

  const sel = $('entryService');
  sel.innerHTML = '<option value="">—</option>' +
    state.masterServices.map(ms =>
      `<option value="${ms.service_id}" data-price="${ms.price}">${escapeHtml(ms.service_name)}</option>`
    ).join('');
}
```

- [ ] **Step 3: Verify in the browser**

Open `register.html` in a browser, log in as a master that has at least one row in `master_services` with both rates populated. In DevTools console run:

```js
state.masterServices[0]
```

Expected: object containing `commission_master_pct: <number>` AND `commission_master_pct_salon: <number>`. The salon value should match what the admin configured (often lower than the own-products rate, often 40 if untouched).

- [ ] **Step 4: Commit**

```bash
git add register.html
git commit -m "feat(pro): load commission_master_pct_salon for split preview"
```

---

## Task 2: Add CSS for `.split-preview` and the static container in the entry card

**Files:**
- Modify: [register.html](register.html) — CSS block (after `.seg-radio input[type="radio"]:checked+label` ~line 259) and entry card HTML (~line 711).

- [ ] **Step 1: Insert CSS rules**

Find the closing `}` of the `.seg-radio input[type="radio"]:checked+label` block (currently ends with `color: var(--bg);` followed by `}` on line 259). Immediately after that block, insert:

```css
    /* ─── Split commission preview (Мастеру / Салону) ─── */
    .split-preview {
      display: grid;
      grid-template-columns: 1fr 1fr;
      margin-top: 10px;
      padding: 10px 0 2px;
      align-items: baseline;
      position: relative;
    }
    .split-preview[hidden] { display: none; }
    .split-preview::before {
      content: "";
      position: absolute;
      left: 50%;
      top: 14px;
      bottom: 6px;
      width: 1px;
      background: var(--hairline);
    }
    .split-side {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 0 12px;
    }
    .split-side.left  { align-items: flex-start; text-align: left; }
    .split-side.right { align-items: flex-end;   text-align: right; }
    .split-role {
      font-size: 9px;
      color: var(--muted);
      letter-spacing: .26em;
      text-transform: uppercase;
      font-weight: 500;
    }
    .split-side.master .split-role { color: var(--accent-deep); }
    .split-pct-val {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .split-side.right .split-pct-val { flex-direction: row-reverse; }
    .split-pct {
      font-size: 11px;
      color: var(--muted);
      font-variant-numeric: tabular-nums;
      letter-spacing: .04em;
    }
    .split-val {
      font-family: var(--serif);
      font-size: 19px;
      color: var(--ink-soft);
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      line-height: 1.1;
    }
    .split-side.master .split-val { color: var(--accent-deep); }
```

- [ ] **Step 2: Insert the entry-card container**

Find the entry-card seg-radio block. The current markup is:

```html
        <div>
          <label class="lbl">Продукты салона</label>
          <div class="seg-radio">
            <input type="radio" name="prodSrc" id="prodOwn"   value="own"   checked>
            <label for="prodOwn">Нет</label>
            <input type="radio" name="prodSrc" id="prodSalon" value="salon">
            <label for="prodSalon">Да</label>
          </div>
        </div>
```

Replace with (adds the empty preview container after the `seg-radio`, both inside the same outer `<div>`):

```html
        <div>
          <label class="lbl">Продукты салона</label>
          <div class="seg-radio">
            <input type="radio" name="prodSrc" id="prodOwn"   value="own"   checked>
            <label for="prodOwn">Нет</label>
            <input type="radio" name="prodSrc" id="prodSalon" value="salon">
            <label for="prodSalon">Да</label>
          </div>
          <div id="splitPreview" class="split-preview" hidden></div>
        </div>
```

- [ ] **Step 3: Verify nothing broke visually**

Reload `register.html` in the browser. Log in. The entry card should look exactly the same as before (preview is `hidden`, so it occupies no space). No console errors.

- [ ] **Step 4: Commit**

```bash
git add register.html
git commit -m "feat(pro): add CSS and container for split commission preview"
```

---

## Task 3: Add the pure `computeSplit` helper

**Files:**
- Modify: [register.html](register.html) — JS block. Place the new function immediately before `function escapeHtml(` (~line 1186).

- [ ] **Step 1: Locate the insertion point**

Search [register.html](register.html) for `function escapeHtml(s) {`. The new helper goes immediately before that.

- [ ] **Step 2: Insert `computeSplit`**

Insert these lines just before `function escapeHtml(`:

```js
    // ─── Split commission preview helpers ────────────────────────
    // Pure: returns the master/salon split for a given service+price+toggle,
    // or null when there is nothing to show. Mirrors the server-side rule used
    // by api/attendance.js: usesSalon=true picks commission_master_pct_salon,
    // false picks commission_master_pct (which is the "own products" rate).
    // salonPay is computed by subtraction so masterPay + salonPay === price
    // even after independent rounding of each side.
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

- [ ] **Step 3: Verify in the browser console**

Reload `register.html`, log in. In DevTools console:

```js
computeSplit(0, 1000, false, state.masterServices)
// → null  (no service)

computeSplit(state.masterServices[0].service_id, 0, false, state.masterServices)
// → null  (no price)

const sid = state.masterServices[0].service_id;
computeSplit(sid, 3500, false, state.masterServices)
// → { masterPct: <own%>, masterPay: <own% × 3500 / 100, rounded>,
//     salonPct: <100 - own%>, salonPay: 3500 - masterPay }

computeSplit(sid, 3500, true, state.masterServices)
// → { masterPct: <salon%>, masterPay: <salon% × 3500 / 100, rounded>,
//     salonPct: <100 - salon%>, salonPay: 3500 - masterPay }
```

Verify in each non-null result: `masterPay + salonPay === 3500` exactly.

- [ ] **Step 4: Commit**

```bash
git add register.html
git commit -m "feat(pro): add computeSplit helper for commission preview"
```

---

## Task 4: Add `renderSplitPreview` DOM helper

**Files:**
- Modify: [register.html](register.html) — JS block, immediately after `computeSplit` (the function added in Task 3).

- [ ] **Step 1: Insert `renderSplitPreview`**

Immediately after the closing `}` of `computeSplit`, insert:

```js
    // Renders or hides the split preview inside `target` (the empty
    // <div class="split-preview"> container). When split is null, the
    // container is hidden and emptied. When split is present, builds
    // the two-side markup and shows it.
    function renderSplitPreview(target, split) {
      if (!target) return;
      if (!split) {
        target.hidden = true;
        target.innerHTML = '';
        return;
      }
      target.innerHTML =
        '<div class="split-side left master">' +
          '<span class="split-role">Мастеру</span>' +
          '<span class="split-pct-val">' +
            '<span class="split-pct">' + split.masterPct + '%</span>' +
            '<span class="split-val">' + fmt(split.masterPay) + '</span>' +
          '</span>' +
        '</div>' +
        '<div class="split-side right">' +
          '<span class="split-role">Салону</span>' +
          '<span class="split-pct-val">' +
            '<span class="split-pct">' + split.salonPct + '%</span>' +
            '<span class="split-val">' + fmt(split.salonPay) + '</span>' +
          '</span>' +
        '</div>';
      target.hidden = false;
    }
```

- [ ] **Step 2: Visual smoke test in console**

Reload `register.html`, log in. In DevTools console:

```js
const t = document.getElementById('splitPreview');
const sid = state.masterServices[0].service_id;
renderSplitPreview(t, computeSplit(sid, 3500, false, state.masterServices));
```

Expected: the preview line appears below the Нет/Да toggle in the entry card with `Мастеру` (in dorado) and `Салону` (in muted), the percent and value matching what `computeSplit` returned.

Then run:

```js
renderSplitPreview(t, null);
```

Expected: preview disappears (back to hidden, empty markup).

- [ ] **Step 3: Commit**

```bash
git add register.html
git commit -m "feat(pro): add renderSplitPreview DOM helper"
```

---

## Task 5: Wire the entry card — `refreshEntryPreview` + bindings

**Files:**
- Modify: [register.html](register.html) — `onServiceChange()` (~line 1427), the `DOMContentLoaded` block (~line 1489), and `saveAttendance()` reset block (~line 1474).

- [ ] **Step 1: Add `refreshEntryPreview` and call it from `onServiceChange`**

The current `onServiceChange` is:

```js
    // ─── Service → price auto-fill ──────────────────────────────
    function onServiceChange() {
      const sel = $('entryService');
      const opt = sel.options[sel.selectedIndex];
      const price = opt ? Number(opt.dataset.price) : 0;
      $('entryPrice').value = price > 0 ? price : '';
    }
```

Replace it with:

```js
    // ─── Service → price auto-fill ──────────────────────────────
    function onServiceChange() {
      const sel = $('entryService');
      const opt = sel.options[sel.selectedIndex];
      const price = opt ? Number(opt.dataset.price) : 0;
      $('entryPrice').value = price > 0 ? price : '';
      refreshEntryPreview();
    }

    // Recompute and re-render the split preview in the main entry card
    // based on the current service / price / Нет-Да toggle.
    function refreshEntryPreview() {
      const serviceId = parseInt($('entryService').value);
      const price = Number($('entryPrice').value);
      const usesSalon = (document.querySelector('input[name="prodSrc"]:checked')?.value === 'salon');
      const split = computeSplit(serviceId, price, usesSalon, state.masterServices);
      renderSplitPreview($('splitPreview'), split);
    }
```

- [ ] **Step 2: Bind `refreshEntryPreview` to price input and toggle change**

Find the `DOMContentLoaded` handler — the line `document.addEventListener('DOMContentLoaded', async () => {`. Inside it, find the existing line `$('historyCard').addEventListener('toggle', onHistoryToggle);`. Immediately after that line (still inside the same handler), insert:

```js
      // Live recompute the split preview as the master changes price or toggle.
      $('entryPrice').addEventListener('input', refreshEntryPreview);
      $('prodOwn').addEventListener('change', refreshEntryPreview);
      $('prodSalon').addEventListener('change', refreshEntryPreview);
```

- [ ] **Step 3: Reset the preview after a successful save**

Find `saveAttendance()`. The current post-save reset block is:

```js
        toast(`Записано. Моё: ${fmt(data.master_pay)}`);
        // Reset transaction fields; default radio back to "own products" for next entry
        $('entryService').value = '';
        $('entryPrice').value = '';
        $('entryClient').value = '';
        const ownRadio = document.getElementById('prodOwn');
        if (ownRadio) ownRadio.checked = true;
        await loadTodayAttendances();
        await refreshHistoryIfLoaded();
```

Add a `refreshEntryPreview();` call right after the radios reset, so the preview hides between entries:

```js
        toast(`Записано. Моё: ${fmt(data.master_pay)}`);
        // Reset transaction fields; default radio back to "own products" for next entry
        $('entryService').value = '';
        $('entryPrice').value = '';
        $('entryClient').value = '';
        const ownRadio = document.getElementById('prodOwn');
        if (ownRadio) ownRadio.checked = true;
        refreshEntryPreview();
        await loadTodayAttendances();
        await refreshHistoryIfLoaded();
```

- [ ] **Step 4: Verify end-to-end in the browser**

Reload `register.html`, log in.

Run through this sequence and confirm each:

1. Empty form → preview hidden.
2. Pick a service from the dropdown → price auto-fills, preview appears with `Мастеру X% · Y ₽` and `Салону` mirroring on the right. The two values must sum to the price.
3. Manually edit the price (e.g., bump 3 500 → 4 000) → both sides recompute live as you type.
4. Tap `Да` → master percent drops to the salon rate, salon percent rises; values update. Tap `Нет` → reverts.
5. Tap `Записать` → toast "Записано. Моё: Y ₽" matches the `Мастеру` value previously shown; the form clears and the preview hides.

If any step fails, fix before moving on.

- [ ] **Step 5: Commit**

```bash
git add register.html
git commit -m "feat(pro): live split preview in выполненная работа card"
```

---

## Task 6: Wire the inline self-complete form on upcoming appointments

**Files:**
- Modify: [register.html](register.html) — `renderUpcoming()` template (~line 947) and a new `refreshSelfPreview(id)` helper placed adjacent to `submitSelfComplete` (~line 1071).

- [ ] **Step 1: Insert preview container in the per-appointment template**

Find inside `renderUpcoming()` the inline block starting `<div id="selfComplete-${a.id}" class="self-complete-form" ...>`. Inside that block, the current markup contains:

```js
                <div>
                  <label class="lbl">Продукты салона</label>
                  <div class="seg-radio">
                    <input type="radio" name="selfProd-${a.id}" id="selfProdOwn-${a.id}" value="own" checked>
                    <label for="selfProdOwn-${a.id}">Нет</label>
                    <input type="radio" name="selfProd-${a.id}" id="selfProdSalon-${a.id}" value="salon">
                    <label for="selfProdSalon-${a.id}">Да</label>
                  </div>
                </div>
```

Replace with (adds the preview container after the seg-radio, still inside the same outer `<div>`):

```js
                <div>
                  <label class="lbl">Продукты салона</label>
                  <div class="seg-radio">
                    <input type="radio" name="selfProd-${a.id}" id="selfProdOwn-${a.id}" value="own" checked>
                    <label for="selfProdOwn-${a.id}">Нет</label>
                    <input type="radio" name="selfProd-${a.id}" id="selfProdSalon-${a.id}" value="salon">
                    <label for="selfProdSalon-${a.id}">Да</label>
                  </div>
                  <div id="splitPreview-${a.id}" class="split-preview" hidden></div>
                </div>
```

- [ ] **Step 2: Add `refreshSelfPreview(id)` helper**

Find `function openSelfComplete(id)` (~line 1068). Just before that line, insert:

```js
    // Recompute and re-render the split preview for the inline self-complete
    // form attached to upcoming appointment `id`. We look up the appointment in
    // state.upcoming to resolve the service_id (the form itself does not carry
    // a service select — the master is completing a pre-booked appointment).
    function refreshSelfPreview(id) {
      const target = $('splitPreview-' + id);
      if (!target) return;
      const appt = state.upcoming.find(x => x.id === id);
      const serviceId = appt ? appt.service_id : 0;
      const price = Number($('selfFinalPrice-' + id)?.value);
      const salonRadio = document.getElementById('selfProdSalon-' + id);
      const usesSalon = !!(salonRadio && salonRadio.checked);
      renderSplitPreview(target, computeSplit(serviceId, price, usesSalon, state.masterServices));
    }
```

- [ ] **Step 3: Bind events and trigger an initial render after each `renderUpcoming`**

Find the end of `renderUpcoming()` — the `}` that closes the function, right after the `list.innerHTML = state.upcoming.map(...).join('');` statement. Just before that closing `}`, insert (still inside `renderUpcoming`):

```js
      // Wire each appointment's self-complete form so its split preview updates
      // live. Bindings are added every render — old DOM nodes are discarded by
      // the innerHTML replacement above, so no manual cleanup is needed.
      for (const a of state.upcoming) {
        const finalEl = $('selfFinalPrice-' + a.id);
        const ownEl   = $('selfProdOwn-' + a.id);
        const salonEl = $('selfProdSalon-' + a.id);
        if (finalEl) finalEl.addEventListener('input', () => refreshSelfPreview(a.id));
        if (ownEl)   ownEl.addEventListener('change', () => refreshSelfPreview(a.id));
        if (salonEl) salonEl.addEventListener('change', () => refreshSelfPreview(a.id));
        // Initial render — uses the default selfFinalPrice value (estimated_price).
        refreshSelfPreview(a.id);
      }
```

- [ ] **Step 4: Verify end-to-end in the browser**

Reload `register.html`, log in as a master with at least one upcoming appointment that has both `service_id` and `estimated_price` set, and whose `master_services` row has the two rates differing.

1. Open "Календарь записей клиентов" — appointments listed.
2. Tap `Выполнено` on one appointment → the inline form expands. The split preview should already be visible inside, computed from `estimated_price` + default `Нет`.
3. Edit "Финальная цена" (e.g., 3 500 → 4 200) → both sides recompute live.
4. Tap `Да` → master percent drops to salon rate; tap `Нет` → reverts.
5. Tap `Сохранить` → server toast appears, the appointment vanishes from the list (now completed). Open another appointment — its preview is independent (no leakage from the previous one).

- [ ] **Step 5: Edge-case verification**

Pick a master where one of her `master_services` rows has `commission_master_pct_salon` equal to `commission_master_pct` (admin set both rates the same). Repeat the entry-card flow for that service. Expected: the preview still renders; the values are symmetric and do not change when the toggle flips.

If you do not have such a row, skip and note in the PR description.

- [ ] **Step 6: Commit**

```bash
git add register.html
git commit -m "feat(pro): live split preview in self-complete appointment form"
```

---

## Final verification checklist (before opening the PR)

Run through this in a clean browser session against the deployed `nicole-salon-pro.vercel.app` (or local with prod Supabase):

- [ ] Log in as a master.
- [ ] Entry card: preview hidden when empty, appears with service + price, recomputes on every change, hides after save.
- [ ] Self-complete form: preview appears on open with default estimated price, recomputes on changes, isolated per appointment.
- [ ] Server `master_pay` toast value matches the `Мастеру` value the master saw before tapping Записать.
- [ ] No regressions: existing flows (login, manual entry, appointment cancel, history filters, new appointment booking) all still work.
- [ ] No console errors at any point.
- [ ] On a 320px-wide viewport (DevTools device toolbar → custom 320×600), the preview line still fits and is legible; the hairline divider stays centered.
