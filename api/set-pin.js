// Vercel serverless — admin sets/resets a master's PIN.
//
// POST /api/set-pin
// Body: { master_id, new_pin, admin_password }
// Response: { ok: true }
//
// Gate: admin_password is compared (constant time) against env var ADMIN_PASSWORD.
// The new PIN is scrypt-hashed and stored in masters.pin_hash.

const { scryptSync, randomBytes, timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function hashPin(pin) {
  const salt = randomBytes(16);
  const hash = scryptSync(String(pin), salt, 64);
  return salt.toString('hex') + ':' + hash.toString('hex');
}

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
      'Prefer': 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0, 400)}`);
  return text ? JSON.parse(text) : null;
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured: Supabase env vars missing' });
  if (!ADMIN_PASSWORD) return json(res, 500, { error: 'Server misconfigured: ADMIN_PASSWORD not set' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const masterId = parseInt(body.master_id);
  const newPin = String(body.new_pin || '');
  const adminPassword = String(body.admin_password || '');

  if (!masterId) return json(res, 400, { error: 'master_id is required' });
  if (!/^\d{4,8}$/.test(newPin)) return json(res, 400, { error: 'new_pin must be 4–8 digits' });
  if (!constantTimeEqualStr(adminPassword, ADMIN_PASSWORD)) {
    // Small delay to slow brute force without external rate-limit infra.
    await new Promise(r => setTimeout(r, 400));
    return json(res, 401, { error: 'Invalid admin password' });
  }

  try {
    const pinHash = hashPin(newPin);
    await sb('PATCH', `masters?id=eq.${masterId}`, { pin_hash: pinHash });
    return json(res, 200, { ok: true });
  } catch (e) {
    console.error('set-pin error:', e);
    return json(res, 500, { error: 'Server error: ' + (e.message || String(e)) });
  }
};
