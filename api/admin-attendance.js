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

// Handlers added in next tasks
async function handleCreate(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleUpdate(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleDelete(body, ip, reason)  { throw Object.assign(new Error('not implemented'), { status: 501 }); }
async function handleRestore(body, ip, reason) { throw Object.assign(new Error('not implemented'), { status: 501 }); }

// Exposed for next tasks via module reuse — also export helpers
module.exports.sb = sb;
module.exports.escMd = escMd;
