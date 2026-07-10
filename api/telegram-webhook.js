// Telegram webhook for customer opt-in.
// A phone is considered Telegram-verified only when the user shares their own
// contact from a private chat with the salon bot.

'use strict';

const { timingSafeEqual } = require('crypto');
const { normalizePhone } = require('./_lib/phone');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

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

async function sb(method, path, body, prefer) {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_ROLE,
      Authorization: `Bearer ${SERVICE_ROLE}`,
      'Content-Type': 'application/json',
      Prefer: prefer || (method === 'POST' ? 'return=representation' : 'return=minimal'),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${method} ${path}: ${response.status} ${text.slice(0, 500)}`);
  return text ? JSON.parse(text) : null;
}

async function telegram(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || !result.ok) throw new Error(result.description || `Telegram HTTP ${response.status}`);
  return result.result;
}

async function askForContact(chatId) {
  return telegram('sendMessage', {
    chat_id: chatId,
    text: 'Чтобы получать напоминания о записях Nicole Beauty, подтвердите свой номер телефона кнопкой ниже.',
    reply_markup: {
      keyboard: [[{ text: 'Подтвердить номер телефона', request_contact: true }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

async function saveVerifiedContact(message) {
  const contact = message.contact;
  if (!contact?.user_id || String(contact.user_id) !== String(message.from?.id)) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Можно подтвердить только собственный номер Telegram. Нажмите кнопку и поделитесь своим контактом.',
    });
    return { verified: false };
  }

  const phone = normalizePhone(contact.phone_number);
  if (!phone) {
    await telegram('sendMessage', {
      chat_id: message.chat.id,
      text: 'Не удалось распознать номер телефона. Пожалуйста, свяжитесь с администратором салона.',
    });
    return { verified: false };
  }

  const now = new Date().toISOString();
  const telegramUserId = String(message.from.id);
  const telegramChatId = String(message.chat.id);

  // A Telegram user may replace their phone. Remove only the user's older
  // mapping, then let the freshly shared contact become authoritative.
  await sb(
    'DELETE',
    `notification_contacts?telegram_user_id=eq.${encodeURIComponent(telegramUserId)}&phone_e164=neq.${encodeURIComponent(phone)}`,
  );
  await sb(
    'POST',
    `notification_contacts?on_conflict=phone_e164`,
    {
      phone_e164: phone,
      telegram_user_id: telegramUserId,
      telegram_chat_id: telegramChatId,
      telegram_username: message.from.username || null,
      telegram_first_name: message.from.first_name || null,
      telegram_verified_at: now,
      telegram_blocked_at: null,
      last_seen_at: now,
      updated_at: now,
    },
    'resolution=merge-duplicates,return=representation',
  );

  await telegram('sendMessage', {
    chat_id: message.chat.id,
    text: 'Готово! Номер подтверждён. Теперь напоминания о ваших записях будут приходить сюда.',
    reply_markup: { remove_keyboard: true },
  });
  return { verified: true, phone };
}

async function handleMembership(update) {
  const member = update.my_chat_member;
  if (!member?.chat?.id) return false;
  const status = member.new_chat_member?.status;
  const patch = {
    telegram_blocked_at: ['kicked', 'left'].includes(status) ? new Date().toISOString() : null,
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  await sb('PATCH', `notification_contacts?telegram_chat_id=eq.${encodeURIComponent(member.chat.id)}`, patch);
  return true;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_ROLE || !BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    return json(res, 500, { error: 'Notification env vars missing' });
  }
  if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], process.env.TELEGRAM_WEBHOOK_SECRET)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  let update = req.body;
  if (typeof update === 'string') {
    try { update = JSON.parse(update); } catch { update = {}; }
  }
  update = update || {};

  try {
    if (await handleMembership(update)) return json(res, 200, { ok: true });

    const message = update.message;
    if (!message || message.chat?.type !== 'private') return json(res, 200, { ok: true, ignored: true });
    if (message.contact) {
      const result = await saveVerifiedContact(message);
      return json(res, 200, { ok: true, ...result });
    }

    await askForContact(message.chat.id);
    return json(res, 200, { ok: true, requested_contact: true });
  } catch (error) {
    console.error('telegram-webhook error:', error);
    // Returning 500 asks Telegram to retry a transiently failed update.
    return json(res, 500, { error: String(error?.message || error) });
  }
};

module.exports.saveVerifiedContact = saveVerifiedContact;
