// Vercel serverless — list audit entries for the admin panel "Журнал правок" tab.
// GET /api/admin-audit?from=YYYY-MM-DD&to=YYYY-MM-DD&master_id=&action=&limit=&offset=
// Auth: ns_admin cookie OR admin_password query param (last resort, not recommended).

const { hasValidSession, makeToken, setCookie } = require('./_lib/admin-session');
const { timingSafeEqual } = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function constantTimeEqualStr(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

async function sb(method, path, headers = {}) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/' + path, {
    method,
    headers: {
      'apikey': SERVICE_ROLE,
      'Authorization': 'Bearer ' + SERVICE_ROLE,
      'Accept': 'application/json',
      ...headers,
    },
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${method} ${path}: ${r.status} ${text.slice(0,400)}`);
  return { rows: text ? JSON.parse(text) : [], total: parseInt((r.headers.get('content-range') || '').split('/')[1]) || null };
}

function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(obj));
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Server misconfigured' });

  const q = req.query || {};
  let authed = hasValidSession(req);
  if (!authed) {
    const pw = String(q.admin_password || '');
    if (pw && ADMIN_PASSWORD && constantTimeEqualStr(pw, ADMIN_PASSWORD)) authed = true;
  }
  if (!authed) return json(res, 401, { error: 'Unauthorized' });

  const filters = [];
  if (q.from)        filters.push(`created_at=gte.${encodeURIComponent(q.from + 'T00:00:00')}`);
  if (q.to)          filters.push(`created_at=lte.${encodeURIComponent(q.to   + 'T23:59:59')}`);
  if (q.action)      filters.push(`action=eq.${encodeURIComponent(q.action)}`);
  if (q.master_id) {
    const mid = parseInt(q.master_id);
    filters.push(`or=(before->>master_id.eq.${mid},after->>master_id.eq.${mid})`);
  }
  if (q.attendance_id) filters.push(`attendance_id=eq.${parseInt(q.attendance_id)}`);

  const limit  = Math.min(parseInt(q.limit)  || 100, 500);
  const offset = Math.max(parseInt(q.offset) || 0, 0);

  const select = 'id,attendance_id,action,actor,actor_ip,before,after,reason,created_at';
  const path = `attendance_audit?select=${select}&order=created_at.desc&limit=${limit}&offset=${offset}` +
    (filters.length ? '&' + filters.join('&') : '');

  try {
    const { rows, total } = await sb('GET', path, { 'Prefer': 'count=exact', 'Range-Unit': 'items', 'Range': `${offset}-${offset+limit-1}` });
    try { const { token } = makeToken(); setCookie(res, token); } catch {}
    return json(res, 200, { rows, total });
  } catch (e) {
    console.error('admin-audit error:', e);
    return json(res, 500, { error: e.message });
  }
};
