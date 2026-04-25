// Vercel serverless — insert a professional attendance record, PIN-validated.
//
// POST /api/attendance
// Body: { master_id, pin, service_id, price, uses_salon_products?, client_name?, payment_method?, note? }
// Response: { ok: true, id, master_pay, commission_pct, uses_salon_products }
//
// Commission rule:
//   uses_salon_products=false (default) → master_services.commission_master_pct       (own products, higher)
//   uses_salon_products=true            → master_services.commission_master_pct_salon (salon products, lower)
//
// Security: PIN is compared to masters.pin_hash (scrypt) with constant-time equality.
// Writes use the Supabase service-role key (server-only env var). The client-facing
// anon key cannot insert into `attendances` because of the RLS policies in
// supabase/schema.sql.

const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_PIN_FAILS_PER_MINUTE = 5;
const MAX_PRICE_MULTIPLIER = 10;   // price override cannot exceed 10× catalogue price

// ─── crypto helpers (scrypt-based) ─────────────────────────────────────────
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

// ─── Supabase REST helpers (service role — bypasses RLS) ──────────────────
async function sb(method, path, body) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': 'Bearer ' + SERVICE_ROLE,
      'Content-Type': 'application/json',
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured: Supabase env vars missing' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const masterId = parseInt(body.master_id);
  const pin = String(body.pin || '');
  const serviceId = parseInt(body.service_id);
  const price = Number(body.price);
  const usesSalonProducts = body.uses_salon_products === true;
  const clientName = (body.client_name || '').toString().slice(0, 200) || null;
  const paymentMethod = (body.payment_method || '').toString().slice(0, 40) || null;
  const note = (body.note || '').toString().slice(0, 500) || null;
  const ip = clientIp(req);

  if (!masterId || !serviceId) return json(res, 400, { error: 'master_id and service_id are required' });
  if (!pin || !/^\d{4,8}$/.test(pin)) return json(res, 400, { error: 'pin must be 4–8 digits' });
  if (!(price > 0) || !Number.isFinite(price)) return json(res, 400, { error: 'price must be a positive number' });

  try {
    // 1. Rate limit — reject if too many recent failures for this master
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const recentFails = await sb(
      'GET',
      `pin_attempts?select=id&master_id=eq.${masterId}&success=is.false&attempted_at=gte.${encodeURIComponent(cutoff)}`,
    );
    if (Array.isArray(recentFails) && recentFails.length >= MAX_PIN_FAILS_PER_MINUTE) {
      res.setHeader('Retry-After', '60');
      return json(res, 429, { error: 'Too many failed attempts. Try again in a minute.' });
    }

    // 2. Load master
    const masters = await sb('GET', `masters?select=id,name,pin_hash&id=eq.${masterId}&limit=1`);
    const master = Array.isArray(masters) ? masters[0] : null;
    if (!master) return json(res, 404, { error: 'Master not found' });
    if (!master.pin_hash) return json(res, 403, { error: 'PIN not configured for this master. Ask the admin to set it.' });

    // 3. Verify PIN (constant-time)
    if (!verifyPin(pin, master.pin_hash)) {
      await sb('POST', 'pin_attempts', { master_id: masterId, ip, success: false }).catch(() => {});
      return json(res, 401, { error: 'Invalid PIN' });
    }

    // 4. Lookup master_services row for (master_id, service_id) — fetch BOTH commission rates
    const ms = await sb('GET', `master_services?select=price,commission_master_pct,commission_master_pct_salon,services(name)&master_id=eq.${masterId}&service_id=eq.${serviceId}&limit=1`);
    const msRow = Array.isArray(ms) ? ms[0] : null;
    if (!msRow) return json(res, 422, { error: 'Service not configured for this master' });

    const catalogPrice = Number(msRow.price) || 0;
    // Pick the right rate based on the product source flag.
    // Server-controlled — client's choice is honoured but the actual rate comes from DB.
    const commissionPct = usesSalonProducts
      ? Number(msRow.commission_master_pct_salon)
      : Number(msRow.commission_master_pct);
    if (!Number.isFinite(commissionPct)) return json(res, 422, { error: 'Commission rate missing for this service' });

    // 5. Price sanity: allow override but bound to avoid mistakes/abuse
    if (catalogPrice > 0 && price > catalogPrice * MAX_PRICE_MULTIPLIER) {
      return json(res, 422, { error: `Price exceeds allowed range (max ${catalogPrice * MAX_PRICE_MULTIPLIER})` });
    }

    // 6. Compute master_pay server-side (client value would be ignored)
    const masterPay = Math.round(price * commissionPct) / 100;   // 2 decimals
    const serviceName = msRow.services?.name || null;

    // 7. Insert attendance
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const todayDate = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    const nowTime = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

    const inserted = await sb('POST', 'attendances', {
      date: todayDate,
      time: nowTime,
      master_id: masterId,
      service_id: serviceId,
      service_name: serviceName,
      price,
      master_pay: masterPay,
      commission_pct: commissionPct,
      uses_salon_products: usesSalonProducts,
      client_name: clientName,
      payment_method: paymentMethod,
      source: 'pro_form',
      note,
    });
    const row = Array.isArray(inserted) ? inserted[0] : inserted;

    // 8. Log successful attempt (audit trail)
    await sb('POST', 'pin_attempts', { master_id: masterId, ip, success: true }).catch(() => {});

    return json(res, 200, {
      ok: true,
      id: row?.id,
      master_pay: masterPay,
      commission_pct: commissionPct,
      uses_salon_products: usesSalonProducts,
      service_name: serviceName,
    });
  } catch (e) {
    console.error('attendance error:', e);
    return json(res, 500, { error: 'Server error: ' + (e.message || String(e)) });
  }
};
