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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured: Supabase env vars missing' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const masterId = parseInt(body.master_id);
  const pin = String(body.pin || '');
  const ip = clientIp(req);

  if (!masterId) return json(res, 400, { error: 'master_id is required' });
  if (!pin || !/^\d{4,8}$/.test(pin)) return json(res, 400, { error: 'pin must be 4–8 digits' });

  try {
    // Rate limit
    const cutoff = new Date(Date.now() - 60 * 1000).toISOString();
    const recentFails = await sb(
      'GET',
      `pin_attempts?select=id&master_id=eq.${masterId}&success=is.false&attempted_at=gte.${encodeURIComponent(cutoff)}`,
    );
    if (Array.isArray(recentFails) && recentFails.length >= MAX_PIN_FAILS_PER_MINUTE) {
      res.setHeader('Retry-After', '60');
      return json(res, 429, { error: 'Too many failed attempts. Try again in a minute.' });
    }

    // Load master + pin_hash
    const masters = await sb('GET', `masters?select=id,name,pin_hash&id=eq.${masterId}&limit=1`);
    const master = Array.isArray(masters) ? masters[0] : null;
    if (!master) return json(res, 404, { error: 'Master not found' });
    if (!master.pin_hash) return json(res, 403, { error: 'PIN not configured for this master' });

    const ok = verifyPin(pin, master.pin_hash);
    await sb('POST', 'pin_attempts', { master_id: masterId, ip, success: ok }).catch(() => {});
    if (!ok) return json(res, 401, { error: 'Invalid PIN' });

    return json(res, 200, { ok: true, master: { id: master.id, name: master.name } });
  } catch (e) {
    console.error('verify-pin error:', e);
    return json(res, 500, { error: 'Server error: ' + (e.message || String(e)) });
  }
};
