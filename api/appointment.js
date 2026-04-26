// Vercel serverless — appointments endpoint.
//
// Routes:
//   POST   /api/appointment                        → create
//   PATCH  /api/appointment                        → status change (admin only)
//   POST   /api/appointment?action=complete        → mark completed + atomic create attendance (RPC)
//
// Gates:
//   admin_password matched against env ADMIN_PASSWORD (constant time)
//   pin + master_id matched against masters.pin_hash (scrypt) — same flow as /api/attendance
//
// Writes always use the Supabase service-role key (server-only env var).
// Browser-facing anon key cannot insert/update/delete due to RLS.

const { scryptSync, timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const MAX_PIN_FAILS_PER_MINUTE = 5;
const SAMARA_OFFSET = '+04:00';

// ─── crypto helpers ────────────────────────────────────────────────
function verifyPin(pin, stored) {
  if (!stored || typeof stored !== 'string' || !stored.includes(':')) return false;
  const [saltHex, hashHex] = stored.split(':');
  let salt, hash, test;
  try {
    salt = Buffer.from(saltHex, 'hex');
    hash = Buffer.from(hashHex, 'hex');
    test = scryptSync(String(pin), salt, 64);
  } catch { return false; }
  return hash.length === test.length && timingSafeEqual(hash, test);
}

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ─── Supabase REST helper (service role — bypasses RLS) ────────────
async function sb(method, path, body, opts = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': 'Bearer ' + SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || (method === 'POST' ? 'return=representation' : 'return=minimal'),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    const err = new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0, 400)}`);
    err.status = r.status;
    err.body = text;
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

// PostgreSQL error code 23505 (unique_violation) surfaces in PostgREST body
// like { "code": "23505", ... }. Inspect the captured body to detect it.
function isUniqueViolation(err) {
  if (!err || !err.body) return false;
  try { return JSON.parse(err.body).code === '23505'; } catch { return false; }
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
}

function escMd(s) { return String(s || '').replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1'); }

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

// ─── Authorization (admin or master+PIN) ───────────────────────────
// Returns { kind: 'admin' } | { kind: 'master', master, masterId } | throws { status, message }.
async function authorize(body, req) {
  const adminPw = body.admin_password ? String(body.admin_password) : '';
  if (adminPw) {
    if (!ADMIN_PASSWORD || !constantTimeEqualStr(adminPw, ADMIN_PASSWORD)) {
      await new Promise(r => setTimeout(r, 400));
      const e = new Error('Invalid admin password'); e.status = 401; throw e;
    }
    return { kind: 'admin' };
  }

  const masterId = parseInt(body.master_id);
  const pin = String(body.pin || '');
  if (!masterId || !pin) {
    const e = new Error('admin_password OR (master_id + pin) required'); e.status = 401; throw e;
  }
  if (!/^\d{4,8}$/.test(pin)) {
    const e = new Error('pin must be 4–8 digits'); e.status = 400; throw e;
  }

  // Rate limit: reject if too many recent failures for this master.
  const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
  const recentFails = await sb(
    'GET',
    `pin_attempts?select=id&master_id=eq.${masterId}&success=is.false&attempted_at=gte.${encodeURIComponent(cutoff)}`,
  );
  if (Array.isArray(recentFails) && recentFails.length >= MAX_PIN_FAILS_PER_MINUTE) {
    const e = new Error('Too many failed attempts. Try again in a minute.'); e.status = 429; throw e;
  }

  const masters = await sb('GET', `masters?select=id,name,pin_hash&id=eq.${masterId}&limit=1`);
  const master = Array.isArray(masters) ? masters[0] : null;
  if (!master) { const e = new Error('Master not found'); e.status = 404; throw e; }
  if (!master.pin_hash) {
    const e = new Error('PIN not configured for this master.'); e.status = 403; throw e;
  }
  const ip = clientIp(req);
  if (!verifyPin(pin, master.pin_hash)) {
    await sb('POST', 'pin_attempts', { master_id: masterId, ip, success: false }).catch(() => {});
    const e = new Error('Invalid PIN'); e.status = 401; throw e;
  }
  await sb('POST', 'pin_attempts', { master_id: masterId, ip, success: true }).catch(() => {});
  return { kind: 'master', master, masterId };
}

// ─── Telegram (await + AbortController, mirrors api/attendance.js) ─
async function notifyTelegram(lines) {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) return;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: process.env.TELEGRAM_CHAT_ID,
        text: lines.filter(Boolean).join('\n'),
        parse_mode: 'Markdown',
      }),
      signal: ctrl.signal,
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => '');
      console.error('telegram notify non-OK:', r.status, detail.slice(0, 300));
    }
  } catch (e) {
    console.error('telegram notify failed:', e?.message || e);
  } finally {
    clearTimeout(timer);
  }
}

// ─── Action handlers (filled in subsequent tasks) ──────────────────
async function handleCreate(body, req) {
  const auth = await authorize(body, req);

  const scheduledLocal = String(body.scheduled_at_local || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(scheduledLocal)) {
    const e = new Error('scheduled_at_local must be YYYY-MM-DDTHH:mm'); e.status = 400; throw e;
  }
  // Append seconds + Samara offset so Postgres reads it as the right absolute instant.
  const scheduledAt = scheduledLocal + ':00' + SAMARA_OFFSET;

  const masterId = parseInt(body.master_id);
  const serviceId = parseInt(body.service_id);
  if (!masterId) { const e = new Error('master_id is required'); e.status = 400; throw e; }
  if (!serviceId) { const e = new Error('service_id is required'); e.status = 400; throw e; }

  // Master-gated callers can only create for themselves.
  if (auth.kind === 'master' && auth.masterId !== masterId) {
    const e = new Error('Masters can only create appointments for themselves'); e.status = 403; throw e;
  }

  const estimatedPriceRaw = body.estimated_price;
  let estimatedPrice = null;
  if (estimatedPriceRaw !== undefined && estimatedPriceRaw !== null && estimatedPriceRaw !== '') {
    estimatedPrice = Number(estimatedPriceRaw);
    if (!Number.isFinite(estimatedPrice) || estimatedPrice < 0) {
      const e = new Error('estimated_price must be a non-negative number'); e.status = 400; throw e;
    }
  }

  const clientName = (body.client_name || '').toString().slice(0, 200) || null;
  const clientPhone = (body.client_phone || '').toString().slice(0, 40) || null;
  const note = (body.note || '').toString().slice(0, 500) || null;

  // Validate the master+service pair exists and capture service name + sanity-check price.
  const ms = await sb(
    'GET',
    `master_services?select=price,services(name)&master_id=eq.${masterId}&service_id=eq.${serviceId}&limit=1`,
  );
  const msRow = Array.isArray(ms) ? ms[0] : null;
  if (!msRow) { const e = new Error('Service not configured for this master'); e.status = 422; throw e; }
  const serviceName = msRow.services?.name || null;
  const catalogPrice = Number(msRow.price) || 0;
  if (estimatedPrice !== null && catalogPrice > 0 && estimatedPrice > catalogPrice * 10) {
    const e = new Error(`estimated_price exceeds allowed range (max ${catalogPrice * 10})`); e.status = 422; throw e;
  }

  const createdBy = auth.kind === 'admin' ? 'admin' : `master:${auth.masterId}`;

  let inserted;
  try {
    inserted = await sb('POST', 'appointments', {
      scheduled_at: scheduledAt,
      master_id: masterId,
      service_id: serviceId,
      service_name: serviceName,
      estimated_price: estimatedPrice,
      client_name: clientName,
      client_phone: clientPhone,
      note,
      status: 'scheduled',
      created_by: createdBy,
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const conflictErr = new Error('Slot already booked for this master');
      conflictErr.status = 409; throw conflictErr;
    }
    throw e;
  }
  const row = Array.isArray(inserted) ? inserted[0] : inserted;

  // Telegram on create (Markdown-escaped values).
  const masterName = auth.kind === 'master' ? auth.master.name : null;
  const masterLabel = masterName || `#${masterId}`;
  const whenLabel = scheduledLocal.replace('T', ' '); // e.g., "2026-04-26 14:00"
  await notifyTelegram([
    '📅 *Новая бронь*',
    '',
    `*Мастер:* ${escMd(masterLabel)}`,
    `*Услуга:* ${escMd(serviceName) || '—'}`,
    `*Когда:* ${escMd(whenLabel)}`,
    clientName ? `*Клиент:* ${escMd(clientName)}` : null,
    estimatedPrice !== null ? `_Оценка: ${estimatedPrice.toLocaleString('ru-RU')} ₽_` : null,
  ]);

  return {
    ok: true,
    id: row?.id,
    scheduled_at: row?.scheduled_at,
    status: row?.status,
    service_name: serviceName,
  };
}
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
async function handleComplete(body, req) {
  const auth = await authorize(body, req);

  const id = parseInt(body.id);
  if (!id) { const e = new Error('id is required'); e.status = 400; throw e; }
  const finalPrice = Number(body.final_price);
  if (!(finalPrice > 0) || !Number.isFinite(finalPrice)) {
    const e = new Error('final_price must be a positive number'); e.status = 400; throw e;
  }
  const paymentMethod = (body.payment_method || '').toString().slice(0, 40) || null;
  const usesSalonProducts = body.uses_salon_products === true;

  // For master-gated callers, refuse if the appointment isn't theirs.
  if (auth.kind === 'master') {
    const rows = await sb('GET', `appointments?select=master_id&id=eq.${id}&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) { const e = new Error('Appointment not found'); e.status = 404; throw e; }
    if (row.master_id !== auth.masterId) {
      const e = new Error('This appointment belongs to another master'); e.status = 403; throw e;
    }
  }

  // Look up appointment + master_services in two GETs (no PostgREST embed since
  // appointments has no FK to master_services).
  const apptArr = await sb(
    'GET',
    `appointments?select=master_id,service_id,service_name,scheduled_at,client_name&id=eq.${id}&limit=1`,
  );
  const apptRow = Array.isArray(apptArr) ? apptArr[0] : null;
  if (!apptRow) { const e = new Error('Appointment not found'); e.status = 404; throw e; }
  const msArr = await sb(
    'GET',
    `master_services?select=price,commission_master_pct,commission_master_pct_salon,services(name)&master_id=eq.${apptRow.master_id}&service_id=eq.${apptRow.service_id}&limit=1`,
  );
  const msRow = Array.isArray(msArr) ? msArr[0] : null;
  if (!msRow) { const e = new Error('Service not configured for this master'); e.status = 422; throw e; }
  // Sanity-bound the final price (10× catalog) — same posture as /api/attendance.
  const catalogPrice = Number(msRow.price) || 0;
  if (catalogPrice > 0 && finalPrice > catalogPrice * 10) {
    const e = new Error(`final_price exceeds allowed range (max ${catalogPrice * 10})`); e.status = 422; throw e;
  }

  // RPC call (atomic insert+update).
  let attendanceId;
  try {
    const rpcResult = await sb(
      'POST',
      'rpc/complete_appointment',
      {
        p_appt_id: id,
        p_final_price: finalPrice,
        p_payment_method: paymentMethod,
        p_uses_salon_products: usesSalonProducts,
      },
      { prefer: 'return=representation' },
    );
    // RPC returning bigint comes back as a JSON number (or array, depending on Prefer).
    attendanceId = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
  } catch (e) {
    // Re-raise with friendly status if the RPC threw on status check.
    if (e.body && /cannot complete/.test(e.body)) {
      const conflictErr = new Error('Appointment is not in a completable state'); conflictErr.status = 409; throw conflictErr;
    }
    throw e;
  }

  // Compute master pay for the Telegram message (mirrors what RPC computed).
  const commissionPct = usesSalonProducts ? Number(msRow.commission_master_pct_salon) : Number(msRow.commission_master_pct);
  const masterPay = Math.round(finalPrice * commissionPct) / 100;
  const serviceName = apptRow.service_name || msRow.services?.name || null;

  // Look up master name for the message.
  let masterName = auth.kind === 'master' ? auth.master.name : null;
  if (!masterName) {
    const mm = await sb('GET', `masters?select=name&id=eq.${apptRow.master_id}&limit=1`);
    masterName = (Array.isArray(mm) && mm[0]?.name) || `#${apptRow.master_id}`;
  }

  await notifyTelegram([
    '✅ *Бронь выполнена*',
    '',
    `*Мастер:* ${escMd(masterName)}`,
    `*Услуга:* ${escMd(serviceName) || '—'}`,
    `*Цена:* ${finalPrice.toLocaleString('ru-RU')} ₽`,
    `*Мастеру:* ${masterPay.toLocaleString('ru-RU')} ₽ (${commissionPct}%)`,
    apptRow.client_name ? `*Клиент:* ${escMd(apptRow.client_name)}` : null,
    paymentMethod ? `*Оплата:* ${escMd(paymentMethod)}` : null,
  ]);

  return {
    ok: true,
    appointment_id: id,
    attendance_id: attendanceId,
    master_pay: masterPay,
    commission_pct: commissionPct,
  };
}

// ─── Entry point ───────────────────────────────────────────────────
module.exports = async (req, res) => {
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured: Supabase env vars missing' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // Vercel parses ?action= into req.query in serverless functions.
  const action = (req.query && req.query.action) || '';

  try {
    let result;
    if (req.method === 'POST' && action === 'complete') {
      result = await handleComplete(body, req);
    } else if (req.method === 'POST') {
      result = await handleCreate(body, req);
    } else if (req.method === 'PATCH') {
      result = await handlePatch(body, req);
    } else {
      return json(res, 405, { error: 'Method not allowed' });
    }
    return json(res, 200, result);
  } catch (e) {
    if (e.status) return json(res, e.status, { error: e.message });
    console.error('appointment error:', e);
    return json(res, 500, { error: 'Server error: ' + (e.message || String(e)) });
  }
};

// Exposed for tests / debugging only.
module.exports.SAMARA_OFFSET = SAMARA_OFFSET;
module.exports.isUniqueViolation = isUniqueViolation;
