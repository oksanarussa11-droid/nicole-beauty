// Shared HMAC-signed admin session cookie helpers.
// Cookie name: ns_admin (Nicole salon admin).
// Payload: base64url JSON { exp: <unix-seconds> }.
// Signed with HMAC-SHA256 using ADMIN_SESSION_SECRET (env).

const { createHmac, timingSafeEqual } = require('crypto');

const COOKIE_NAME = 'ns_admin';
const TTL_SECONDS = 15 * 60;

function secret() {
  const s = process.env.ADMIN_SESSION_SECRET;
  if (!s || s.length < 16) throw new Error('ADMIN_SESSION_SECRET not set or too short (>=16 chars)');
  return s;
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function sign(payloadB64) {
  return b64url(createHmac('sha256', secret()).update(payloadB64).digest());
}

function makeToken(ttlSeconds = TTL_SECONDS) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload = b64url(JSON.stringify({ exp }));
  const sig = sign(payload);
  return { token: `${payload}.${sig}`, exp };
}

function verifyToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expectedSig = sign(payload);
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed;
  try { parsed = JSON.parse(b64urlDecode(payload).toString('utf8')); } catch { return null; }
  if (!parsed?.exp || Date.now() / 1000 > parsed.exp) return null;
  return parsed;
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const out = {};
  raw.split(/;\s*/).forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i)] = decodeURIComponent(p.slice(i + 1));
  });
  return out;
}

function setCookie(res, token) {
  const isProd = process.env.VERCEL_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'SameSite=Strict',
    'Path=/',
    `Max-Age=${TTL_SECONDS}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`);
}

// Returns true if request carries a valid session cookie.
function hasValidSession(req) {
  const cookies = parseCookies(req);
  return !!verifyToken(cookies[COOKIE_NAME]);
}

module.exports = {
  COOKIE_NAME,
  TTL_SECONDS,
  makeToken,
  verifyToken,
  parseCookies,
  setCookie,
  clearCookie,
  hasValidSession,
};
