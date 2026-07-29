#!/usr/bin/env node
// One-off correction: the 8 attendances stored as 2026-07-07 belong to 2026-07-06.
//
// Why: both index.html and register.html stamp the date with
// `new Date().toISOString().split('T')[0]` — a UTC date. These 8 records were
// created at 2026-07-07T02:28Z, i.e. late on 06.07 local time, so they were
// auto-dated to the next day. Evidence that 06.07 is the true business day:
//   • no attendances exist on 2026-07-06 at all;
//   • the master payout for that day (expense id=142, 2 608 ₽) was dated 06.07
//     by hand, and matches the commission of these 8 records to the ruble.
//
// Runs through /api/admin-attendance so every edit lands in attendance_audit
// (ЖУРНАЛ ПРАВОК). Anon has SELECT-only on attendances, so the admin password
// is required — it is read from the environment and never stored here.
//
//   Dry run:  node scripts/fix-attendance-dates-20260706.mjs
//   Apply:    ADMIN_PASSWORD='…' node scripts/fix-attendance-dates-20260706.mjs --apply
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const FROM = '2026-07-07';
const TO   = '2026-07-06';
const SITE = process.env.SITE_URL || 'https://nicole-beauty.vercel.app';
const APPLY = process.argv.includes('--apply');
const PW = process.env.ADMIN_PASSWORD || '';
const REASON =
  'Коррекция даты: записи автоматически проставлены по UTC (созданы 07.07 в 02:28 UTC), ' +
  'фактический рабочий день — 06.07; выплата мастеру за этот день уже датирована 06.07.';

// The prod anon key is public by design (RLS-protected) — reuse config.js so this
// script never carries its own copy of any credential.
const cfg = fs.readFileSync(path.join(ROOT, 'config.js'), 'utf8').split('} else {')[1] || '';
const url = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(cfg)?.[1];
const key = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(cfg)?.[1];
if (!url || !key) { console.error('Could not read prod Supabase config from config.js'); process.exit(1); }

const res = await fetch(`${url}/rest/v1/attendances?select=*&date=eq.${FROM}&deleted_at=is.null&order=time.asc`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } });
if (!res.ok) { console.error('Fetch failed:', res.status, await res.text()); process.exit(1); }
const rows = await res.json();

if (rows.length === 0) { console.log(`Nothing dated ${FROM} — already corrected.`); process.exit(0); }

const backup = path.join(ROOT, `attendances-${FROM}-backup.json`);
if (!fs.existsSync(backup)) fs.writeFileSync(backup, JSON.stringify(rows, null, 2));
console.log(`${rows.length} records dated ${FROM} → ${TO}   (backup: ${path.relative(ROOT, backup)})`);
for (const a of rows) console.log(`  id=${a.id} master=${a.master_id} service=${a.service_id} price=${a.price} pay=${a.master_pay}`);
console.log(`  Σ price=${rows.reduce((s, a) => s + Number(a.price), 0)}  Σ master_pay=${rows.reduce((s, a) => s + Number(a.master_pay), 0)}`);

if (!APPLY) { console.log('\n[dry run] nothing written. Re-run with --apply and ADMIN_PASSWORD set.'); process.exit(0); }
if (!PW) { console.error('\nADMIN_PASSWORD is required to apply.'); process.exit(1); }

let failed = 0;
for (const a of rows) {
  const r = await fetch(`${SITE}/api/admin-attendance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'update', id: a.id, admin_password: PW, reason: REASON,
      // Send every field back: handleUpdate rewrites the whole row, so anything
      // omitted here (client_name, note, payment_method) would be nulled out.
      fields: {
        date: TO,
        time: a.time,
        master_id: a.master_id,
        service_id: a.service_id,
        price: a.price,
        uses_salon_products: a.uses_salon_products === true,
        client_name: a.client_name,
        payment_method: a.payment_method,
        note: a.note,
      },
    }),
  });
  const j = await r.json().catch(() => ({}));
  console.log(`  id=${a.id} → ${r.status} ${r.ok ? `ok (master_pay=${j.master_pay})` : JSON.stringify(j)}`);
  if (!r.ok) { failed++; break; }
}
if (failed) { console.error(`\nAborted. Restore from ${path.relative(ROOT, backup)} if needed.`); process.exit(1); }
console.log('\nDone. Check ФИНАНСЫ → «Комиссии: начислено и выплачено» — 06.07/07.07 rows should disappear.');
