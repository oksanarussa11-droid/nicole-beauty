// Vercel Cron — sends appointment reminders approximately 3 hours beforehand.
// GET /api/appointment-reminders, authenticated with CRON_SECRET.

'use strict';

const { timingSafeEqual } = require('crypto');
const {
  sendTelegram,
  sendSmsRu,
  getSmsRuStatuses,
  smsRuDeliveryState,
} = require('./_lib/reminder-providers');
const { normalizePhone, maskPhone } = require('./_lib/phone');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

async function updateDelivery(id, patch) {
  return sb('PATCH', `notification_deliveries?id=eq.${id}`, {
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

function samaraParts(iso) {
  const parts = new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Samara',
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(iso));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function buildMessages(delivery) {
  const p = samaraParts(delivery.appointment_scheduled_at);
  const when = `${p.day}.${p.month} в ${p.hour}:${p.minute}`;
  const service = delivery.service_name || 'услуга в салоне';
  const master = delivery.master_name || 'мастер Nicole Beauty';
  return {
    telegram: [
      'Напоминание о записи в Nicole Beauty 💅',
      '',
      `Дата и время: ${when}`,
      `Услуга: ${service}`,
      `Мастер: ${master}`,
      '',
      'Ждём вас!',
    ].join('\n'),
    sms: `Nicole Beauty: напоминаем о записи ${when}. ${service}, мастер ${master}.`,
  };
}

function failurePatch(result) {
  return {
    status: 'failed',
    retryable: !!result.retryable,
    next_retry_at: result.retryable ? new Date(Date.now() + 2 * 60 * 1000).toISOString() : null,
    provider_status_code: result.code == null ? null : String(result.code),
    provider_status_text: result.description || null,
    error_detail: result.description || 'Falha desconhecida no provedor',
  };
}

async function markSmsResult(delivery, result, fallbackFrom) {
  if (result.ok) {
    await updateDelivery(delivery.id, {
      channel: 'sms',
      fallback_from: fallbackFrom || delivery.fallback_from || null,
      provider: 'sms_ru',
      status: 'sent',
      retryable: false,
      next_retry_at: null,
      provider_message_id: result.messageId || null,
      provider_status_code: String(result.code || 100),
      provider_status_text: result.description || 'Aceito pelo SMS.RU',
      sent_at: new Date().toISOString(),
      error_detail: null,
    });
    return 'sent';
  }
  await updateDelivery(delivery.id, {
    channel: 'sms',
    fallback_from: fallbackFrom || delivery.fallback_from || null,
    provider: 'sms_ru',
    ...failurePatch(result),
  });
  return 'failed';
}

async function sendBySms(delivery, text, fallbackFrom) {
  const result = await sendSmsRu({
    apiId: process.env.SMS_RU_API_ID,
    from: process.env.SMS_RU_FROM,
    phoneE164: delivery.phone_e164,
    text,
  });
  return markSmsResult(delivery, result, fallbackFrom);
}

async function appointmentStillMatches(delivery) {
  const rows = await sb(
    'GET',
    `appointments?select=status,scheduled_at&id=eq.${delivery.appointment_id}&limit=1`,
  );
  const appointment = Array.isArray(rows) ? rows[0] : null;
  return !!appointment &&
    ['scheduled', 'confirmed'].includes(appointment.status) &&
    new Date(appointment.scheduled_at).getTime() === new Date(delivery.appointment_scheduled_at).getTime();
}

async function processDelivery(delivery) {
  if (!(await appointmentStillMatches(delivery))) {
    await updateDelivery(delivery.id, {
      status: 'skipped',
      retryable: false,
      error_detail: 'Запись отменена, завершена или перенесена до отправки',
    });
    return 'skipped';
  }

  if (delivery.channel === 'none' || !delivery.phone_e164) {
    await updateDelivery(delivery.id, {
      status: 'skipped',
      retryable: false,
      error_detail: 'У записи отсутствует корректный номер телефона',
    });
    return 'skipped';
  }

  const messages = buildMessages(delivery);
  if (delivery.channel === 'sms') return sendBySms(delivery, messages.sms);

  const telegram = await sendTelegram({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: delivery.telegram_chat_id,
    text: messages.telegram,
  });
  if (telegram.ok) {
    await updateDelivery(delivery.id, {
      provider: 'telegram',
      status: 'sent',
      retryable: false,
      next_retry_at: null,
      provider_message_id: telegram.messageId || null,
      provider_status_code: '200',
      provider_status_text: 'Сообщение принято Telegram',
      sent_at: new Date().toISOString(),
      error_detail: null,
    });
    return 'sent';
  }

  // A blocked/deleted Telegram chat is no longer a valid registration.  Mark it
  // and immediately use the phone fallback required by the business flow.
  if (!telegram.retryable && delivery.phone_e164) {
    if (telegram.blocked) {
      await sb(
        'PATCH',
        `notification_contacts?telegram_chat_id=eq.${encodeURIComponent(delivery.telegram_chat_id)}`,
        { telegram_blocked_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      ).catch(error => console.error('Falha ao bloquear contato Telegram:', error));
    }
    return sendBySms(delivery, messages.sms, 'telegram');
  }

  await updateDelivery(delivery.id, { provider: 'telegram', ...failurePatch(telegram) });
  return 'failed';
}

async function reconcileSmsStatuses() {
  if (!process.env.SMS_RU_API_ID) return { checked: 0, updated: 0 };
  const rows = await sb(
    'GET',
    'notification_deliveries?select=id,provider_message_id&channel=eq.sms&provider=eq.sms_ru&status=eq.sent&provider_message_id=not.is.null&order=sent_at.asc&limit=100',
  );
  if (!Array.isArray(rows) || !rows.length) return { checked: 0, updated: 0 };

  const statuses = await getSmsRuStatuses({
    apiId: process.env.SMS_RU_API_ID,
    messageIds: rows.map(row => row.provider_message_id),
  });
  let updated = 0;
  for (const row of rows) {
    const item = statuses[row.provider_message_id];
    if (!item || item.status !== 'OK') continue;
    const status = smsRuDeliveryState(item.status_code);
    await updateDelivery(row.id, {
      status,
      provider_status_code: String(item.status_code),
      provider_status_text: item.status_text || null,
      delivered_at: status === 'delivered' ? new Date().toISOString() : null,
      error_detail: status === 'failed' ? item.status_text || 'SMS não entregue' : null,
    });
    updated += 1;
  }
  return { checked: rows.length, updated };
}

async function runPool(rows, concurrency, worker) {
  const results = [];
  let cursor = 0;
  async function next() {
    while (cursor < rows.length) {
      const index = cursor++;
      try { results[index] = await worker(rows[index]); }
      catch (error) {
        console.error('Erro processando lembrete:', rows[index]?.id, error);
        await updateDelivery(rows[index].id, failurePatch({ retryable: true, description: String(error?.message || error) })).catch(() => {});
        results[index] = 'failed';
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, rows.length) }, () => next()));
  return results;
}

async function telegram(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
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

async function configureTelegramWebhook() {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_WEBHOOK_SECRET) {
    throw new Error('Telegram env vars missing');
  }
  const baseUrl = String(process.env.PUBLIC_BASE_URL || 'https://nicole-beauty.vercel.app').replace(/\/$/, '');
  const bot = await telegram('getMe');
  await telegram('setWebhook', {
    url: `${baseUrl}/api/telegram-webhook`,
    secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
    allowed_updates: ['message', 'my_chat_member'],
  });
  return {
    ok: true,
    webhook_url: `${baseUrl}/api/telegram-webhook`,
    bot: { id: bot.id, username: bot.username || null },
  };
}

async function validateTelegramReminder(phoneInput) {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    const error = new Error('Supabase env vars missing');
    error.statusCode = 500;
    throw error;
  }

  const phone = normalizePhone(phoneInput);
  if (!phone) {
    const error = new Error('Invalid phone number');
    error.statusCode = 400;
    throw error;
  }

  const contacts = await sb(
    'GET',
    `notification_contacts?select=telegram_chat_id,telegram_verified_at,telegram_blocked_at&phone_e164=eq.${encodeURIComponent(phone)}&telegram_verified_at=not.is.null&telegram_blocked_at=is.null&limit=1`,
  );
  const contact = Array.isArray(contacts) ? contacts[0] : null;
  if (!contact?.telegram_chat_id) {
    const error = new Error('Telegram contact not verified for this phone');
    error.statusCode = 404;
    throw error;
  }

  const result = await sendTelegram({
    token: process.env.TELEGRAM_BOT_TOKEN,
    chatId: contact.telegram_chat_id,
    text: [
      'Тест напоминания Nicole Beauty ✅',
      '',
      'Telegram успешно подтверждён для уведомлений о записи.',
      'Это тестовое сообщение, визит не был создан или изменён.',
    ].join('\n'),
  });
  if (!result.ok) {
    const error = new Error(result.description || 'Telegram test delivery failed');
    error.statusCode = result.retryable ? 503 : 502;
    throw error;
  }

  return {
    ok: true,
    channel: 'telegram',
    provider: 'telegram',
    phone: maskPhone(phone),
    provider_message_id: result.messageId || null,
  };
}

module.exports = async (req, res) => {
  if (!['GET', 'POST'].includes(req.method)) return json(res, 405, { error: 'Method not allowed' });
  // The same repository is deployed as the masters' SITE=pro project. Vercel
  // reads the same cron config there, so exit before claiming any delivery.
  // Only the admin project is allowed to run the notification pipeline.
  if (process.env.SITE === 'pro') {
    return json(res, 200, { ok: true, skipped: 'pro_project' });
  }
  if (!process.env.CRON_SECRET || !safeEqual(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) {
    return json(res, 401, { error: 'Unauthorized' });
  }

  if (req.method === 'POST') {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = {}; }
    }
    try {
      if (body?.action === 'configure_telegram_webhook') {
        return json(res, 200, await configureTelegramWebhook());
      }
      if (body?.action === 'validate_telegram_reminder') {
        return json(res, 200, await validateTelegramReminder(body.phone));
      }
      return json(res, 400, { error: 'Unsupported action' });
    } catch (error) {
      console.error('appointment-reminders operation error:', error);
      return json(res, Number(error?.statusCode || 502), { error: String(error?.message || error) });
    }
  }

  if (!SUPABASE_URL || !SERVICE_ROLE) return json(res, 500, { error: 'Supabase env vars missing' });

  try {
    let reconciliation = { checked: 0, updated: 0 };
    try { reconciliation = await reconcileSmsStatuses(); }
    catch (error) { console.error('Falha reconciliando SMS.RU:', error); }

    const claimed = await sb(
      'POST',
      'rpc/claim_due_appointment_reminders',
      { p_now: new Date().toISOString(), p_limit: 50 },
      'return=representation',
    );
    const rows = Array.isArray(claimed) ? claimed : [];
    const outcomes = await runPool(rows, 3, processDelivery);
    const summary = outcomes.reduce((acc, status) => {
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    return json(res, 200, { ok: true, claimed: rows.length, outcomes: summary, reconciliation });
  } catch (error) {
    console.error('appointment-reminders error:', error);
    return json(res, 500, { error: String(error?.message || error) });
  }
};

module.exports.buildMessages = buildMessages;
module.exports.samaraParts = samaraParts;
module.exports.configureTelegramWebhook = configureTelegramWebhook;
module.exports.validateTelegramReminder = validateTelegramReminder;
