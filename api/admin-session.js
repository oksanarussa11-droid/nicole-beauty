// Vercel serverless — unlock admin "edit mode".
// POST /api/admin-session         → body { admin_password } → sets ns_admin cookie 15min
// POST /api/admin-session?end=1   → clears the cookie (lock now)

const { timingSafeEqual } = require('crypto');
const { makeToken, setCookie, clearCookie } = require('./_lib/admin-session');

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

  if (req.query?.end === '1' || req.url?.includes('end=1')) {
    clearCookie(res);
    return json(res, 200, { ok: true, locked: true });
  }

  if (!ADMIN_PASSWORD) return json(res, 500, { error: 'ADMIN_PASSWORD not set' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  const pw = String(body.admin_password || '');
  if (!pw) return json(res, 400, { error: 'admin_password required' });

  if (!constantTimeEqualStr(pw, ADMIN_PASSWORD)) {
    await new Promise(r => setTimeout(r, 400));
    return json(res, 401, { error: 'Неверный пароль' });
  }

  let token, exp;
  try { ({ token, exp } = makeToken()); }
  catch (e) { return json(res, 500, { error: e.message }); }

  setCookie(res, token);
  return json(res, 200, { ok: true, expires_at: exp });
};
