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
    pay = {
      master_pay: Number(before.master_pay),
      commission_pct: Number(before.commission_pct),
      service_name: before.service_name,
      master_name: null,
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

  const watch = ['date','time','master_id','service_id','price','master_pay','commission_pct','uses_salon_products','client_name','payment_method','note'];
  const diffs = watch
    .filter(k => String(before[k] ?? '') !== String(after[k] ?? ''))
    .map(k => `${k}: ${escMd(String(before[k] ?? '—'))} → ${escMd(String(after[k] ?? '—'))}`);

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

async function handleDelete(body, ip, reason) {
  const id = parseInt(body.id);
  if (!id) { const e = new Error('id required'); e.status = 400; throw e; }

  const cur = await sb('GET', `attendances?select=*&id=eq.${id}&limit=1`);
  const before = Array.isArray(cur) ? cur[0] : null;
  if (!before) { const e = new Error('Attendance not found'); e.status = 404; throw e; }
  if (before.deleted_at) {
    return { id, already_deleted: true };
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

// Exposed for next tasks via module reuse — also export helpers
module.exports.sb = sb;
module.exports.escMd = escMd;
