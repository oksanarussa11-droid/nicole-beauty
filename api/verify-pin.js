// Vercel serverless — verify a master's PIN (used by /register login step).
//
// POST /api/verify-pin
// Body: { master_id, pin }
// Response: { ok: true, master: { id, name } }  OR  4xx with { error }
//
// Same rate-limit and scrypt verification as /api/attendance, but without any insert.

const { scryptSync, timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const MAX_PIN_FAILS_PER_MINUTE = 5;

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
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0, 400)}`);
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

// Generic auth failure response — same for "master not found", "PIN not set",
// and "wrong PIN" to prevent name enumeration from the login endpoint.
const AUTH_FAIL = { error: 'Неверное имя или PIN' };
const AUTH_FAIL_DELAY_MS = 350;

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured: Supabase env vars missing' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const masterName = String(body.master_name || '').trim();
  const pin = String(body.pin || '');
  const ip = clientIp(req);

  if (!masterName) return json(res, 400, { error: 'master_name is required' });
  if (!pin || !/^\d{4,8}$/.test(pin)) return json(res, 400, { error: 'pin must be 4–8 digits' });
  // Accept up to 120 chars to keep the DB query bounded
  if (masterName.length > 120) return json(res, 400, { error: 'master_name too long' });

  try {
    // Look up master by name (case-insensitive exact match).
    // We escape `,` in the name to protect against PostgREST operator injection;
    // other chars are safe inside a quoted ilike value.
    const encoded = encodeURIComponent(masterName.replace(/,/g, '\\,'));
    const masters = await sb('GET', `masters?select=id,name,pin_hash&name=ilike.${encoded}&limit=1`);
    const master = Array.isArray(masters) ? masters[0] : null;

    // Unknown name → return same 401 as wrong PIN to prevent enumeration.
    if (!master) {
      await delay(AUTH_FAIL_DELAY_MS);
      return json(res, 401, AUTH_FAIL);
    }

    // Rate-limit failed attempts per master_id (known name path only).
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const recentFails = await sb(
      'GET',
      `pin_attempts?select=id&master_id=eq.${master.id}&success=is.false&attempted_at=gte.${encodeURIComponent(cutoff)}`,
    );
    if (Array.isArray(recentFails) && recentFails.length >= MAX_PIN_FAILS_PER_MINUTE) {
      res.setHeader('Retry-After', '60');
      return json(res, 429, { error: 'Слишком много неудачных попыток. Попробуйте через минуту.' });
    }

    if (!master.pin_hash) {
      // Same 401 as invalid — don't reveal that a master exists but has no PIN.
      await sb('POST', 'pin_attempts', { master_id: master.id, ip, success: false }).catch(() => {});
      await delay(AUTH_FAIL_DELAY_MS);
      return json(res, 401, AUTH_FAIL);
    }

    const ok = verifyPin(pin, master.pin_hash);
    await sb('POST', 'pin_attempts', { master_id: master.id, ip, success: ok }).catch(() => {});
    if (!ok) {
      await delay(AUTH_FAIL_DELAY_MS);
      return json(res, 401, AUTH_FAIL);
    }

    return json(res, 200, { ok: true, master: { id: master.id, name: master.name } });
  } catch (e) {
    console.error('verify-pin error:', e);
    return json(res, 500, { error: 'Server error: ' + (e.message || String(e)) });
  }
};
