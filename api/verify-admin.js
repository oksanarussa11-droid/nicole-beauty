// Vercel serverless — verify the admin PIN (gate for /).
//
// POST /api/verify-admin
// Body: { pin }
// Response: { ok: true }  OR  401 { error }
//
// Checks the submitted PIN against the ADMIN_PASSWORD env var in
// constant time. A ~400 ms delay on failure slows brute force.

const { timingSafeEqual } = require('crypto');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!ADMIN_PASSWORD) return json(res, 500, { error: 'Server misconfigured: ADMIN_PASSWORD not set' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const pin = String(body.pin || '');
  if (!pin) return json(res, 400, { error: 'pin is required' });

  if (constantTimeEqualStr(pin, ADMIN_PASSWORD)) {
    return json(res, 200, { ok: true });
  }
  await new Promise(r => setTimeout(r, 400));
  return json(res, 401, { error: 'Неверный PIN' });
};
