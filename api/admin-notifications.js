// Admin API for reminder delivery logs and Telegram registration checks.

'use strict';

const { timingSafeEqual } = require('crypto');
const { hasValidSession, makeToken, setCookie } = require('./_lib/admin-session');
const { normalizePhone, maskPhone } = require('./_lib/phone');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

function safeEqual(a, b) {
  const left = Buffer.from(String(a || ''), 'utf8');
  const right = Buffer.from(String(b || ''), 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(res, code, payload) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function sb(path, headers = {}) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      Accept: 'application/json',
      ...headers,
    },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase GET ${path}: ${response.status} ${text.slice(0, 500)}`);
  const totalRaw = (response.headers.get('content-range') || '').split('/')[1];
  return { rows: text ? JSON.parse(text) : [], total: totalRaw && totalRaw !== '*' ? Number(totalRaw) : null };
}

function authenticate(req) {
  if (hasValidSession(req)) return true;
  return !!ADMIN_PASSWORD && safeEqual(req.headers['x-admin-password'], ADMIN_PASSWORD);
}

async function contactStatus(phoneRaw) {
  const phone = normalizePhone(phoneRaw);
  if (!phone) return { valid: false, telegram_verified: false, planned_channel: 'none' };
  const { rows } = await sb(
    `notification_contacts?select=telegram_verified_at,telegram_blocked_at&phone_e164=eq.${encodeURIComponent(phone)}&limit=1`,
  );
  const contact = rows[0];
  const verified = !!contact?.telegram_verified_at && !contact?.telegram_blocked_at;
  return { valid: true, phone_e164: phone, telegram_verified: verified, planned_channel: verified ? 'telegram' : 'sms' };
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Supabase env vars missing' });
  if (!authenticate(req)) return json(res, 401, { error: 'Unauthorized' });

  const query = req.query || {};
  try {
    if (query.phone) {
      const result = await contactStatus(query.phone);
      try { const { token } = makeToken(); setCookie(res, token); } catch {}
      return json(res, 200, result);
    }

    const filters = [];
    if (query.from) filters.push(`created_at=gte.${encodeURIComponent(query.from + 'T00:00:00Z')}`);
    if (query.to) filters.push(`created_at=lte.${encodeURIComponent(query.to + 'T23:59:59Z')}`);
    if (['telegram', 'sms', 'none'].includes(query.channel)) filters.push(`channel=eq.${query.channel}`);
    if (['processing', 'sent', 'delivered', 'failed', 'skipped'].includes(query.status)) filters.push(`status=eq.${query.status}`);

    const limit = Math.min(Math.max(Number.parseInt(query.limit) || 50, 1), 200);
    const offset = Math.max(Number.parseInt(query.offset) || 0, 0);
    const select = [
      'id', 'appointment_id', 'appointment_scheduled_at', 'scheduled_for',
      'client_name', 'phone_e164', 'service_name', 'master_name', 'channel',
      'fallback_from', 'status', 'provider', 'provider_message_id',
      'provider_status_code', 'provider_status_text', 'attempt_count',
      'attempted_at', 'sent_at', 'delivered_at', 'error_detail', 'created_at',
    ].join(',');
    const path = `notification_deliveries?select=${select}&order=created_at.desc&limit=${limit}&offset=${offset}` +
      (filters.length ? '&' + filters.join('&') : '');

    const [logs, activeContacts] = await Promise.all([
      sb(path, { Prefer: 'count=exact', 'Range-Unit': 'items', Range: `${offset}-${offset + limit - 1}` }),
      sb('notification_contacts?select=id&telegram_blocked_at=is.null&limit=1', {
        Prefer: 'count=exact',
        'Range-Unit': 'items',
        Range: '0-0',
      }),
    ]);

    const rows = logs.rows.map(row => ({
      ...row,
      phone_e164: row.phone_e164 ? maskPhone(row.phone_e164) : null,
    }));
    try { const { token } = makeToken(); setCookie(res, token); } catch {}
    return json(res, 200, {
      rows,
      total: logs.total ?? rows.length,
      active_telegram_contacts: activeContacts.total ?? activeContacts.rows.length,
    });
  } catch (error) {
    console.error('admin-notifications error:', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
};

module.exports.contactStatus = contactStatus;
