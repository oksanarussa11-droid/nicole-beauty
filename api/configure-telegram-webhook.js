// Secure operational endpoint for (re)registering the Telegram webhook after
// rotating sensitive Vercel environment variables.

'use strict';

const { timingSafeEqual } = require('crypto');

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

async function telegram(token, method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload || {}),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) {
    throw new Error(result.description || `Telegram HTTP ${response.status}`);
  }
  return result.result;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });

  const cronSecret = process.env.CRON_SECRET;
  const authorization = String(req.headers.authorization || '');
  if (!cronSecret || !safeEqual(authorization, `Bearer ${cronSecret}`)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const webhookSecret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!token || !webhookSecret) {
    return json(res, 500, { error: 'Telegram env vars missing' });
  }

  try {
    const baseUrl = String(process.env.PUBLIC_BASE_URL || 'https://nicole-beauty.vercel.app').replace(/\/$/, '');
    const bot = await telegram(token, 'getMe');
    await telegram(token, 'setWebhook', {
      url: `${baseUrl}/api/telegram-webhook`,
      secret_token: webhookSecret,
      allowed_updates: ['message', 'my_chat_member'],
    });
    return json(res, 200, {
      ok: true,
      webhook_url: `${baseUrl}/api/telegram-webhook`,
      bot: { id: bot.id, username: bot.username || null },
    });
  } catch (error) {
    console.error('configure-telegram-webhook error:', error);
    return json(res, 502, { error: String(error?.message || error) });
  }
};
