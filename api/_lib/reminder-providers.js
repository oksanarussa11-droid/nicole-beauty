'use strict';

const { smsRuPhone } = require('./phone');

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

async function sendTelegram({ token, chatId, text }) {
  if (!token) return { ok: false, retryable: false, description: 'TELEGRAM_BOT_TOKEN não configurado' };
  const timeout = timeoutSignal(8000);
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: timeout.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (response.ok && result.ok) {
      return { ok: true, messageId: String(result.result?.message_id || '') };
    }
    const code = Number(result.error_code || response.status || 0);
    return {
      ok: false,
      code,
      blocked: code === 403,
      retryable: code === 429 || code >= 500,
      description: String(result.description || `Telegram HTTP ${response.status}`).slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      description: error?.name === 'AbortError' ? 'Telegram timeout' : String(error?.message || error),
    };
  } finally {
    timeout.done();
  }
}

async function sendSmsRu({ apiId, from, phoneE164, text }) {
  if (!apiId) return { ok: false, retryable: false, description: 'SMS_RU_API_ID não configurado' };
  const recipient = smsRuPhone(phoneE164);
  const body = new URLSearchParams({ api_id: apiId, to: recipient, msg: text, json: '1' });
  if (from) body.set('from', from);

  const timeout = timeoutSignal(10000);
  try {
    const response = await fetch('https://sms.ru/sms/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      signal: timeout.signal,
    });
    const result = await response.json().catch(() => ({}));
    const item = result.sms?.[recipient];
    const code = Number(item?.status_code ?? result.status_code ?? response.status);
    if (response.ok && result.status === 'OK' && item?.status === 'OK' && code === 100) {
      return {
        ok: true,
        messageId: String(item.sms_id || ''),
        code,
        description: String(item.status_text || 'Aceito pelo SMS.RU'),
      };
    }
    return {
      ok: false,
      code,
      retryable: response.status >= 500 || code >= 300 && code < 500,
      description: String(item?.status_text || result.status_text || `SMS.RU HTTP ${response.status}`).slice(0, 500),
    };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      description: error?.name === 'AbortError' ? 'SMS.RU timeout' : String(error?.message || error),
    };
  } finally {
    timeout.done();
  }
}

async function getSmsRuStatuses({ apiId, messageIds }) {
  if (!apiId || !messageIds.length) return {};
  const body = new URLSearchParams({ api_id: apiId, sms_id: messageIds.join(','), json: '1' });
  const timeout = timeoutSignal(10000);
  try {
    const response = await fetch('https://sms.ru/sms/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body,
      signal: timeout.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.status !== 'OK') throw new Error(result.status_text || `SMS.RU HTTP ${response.status}`);
    return result.sms || {};
  } finally {
    timeout.done();
  }
}

function smsRuDeliveryState(code) {
  const n = Number(code);
  if (n === 103) return 'delivered';
  if ([100, 101, 102].includes(n)) return 'sent';
  if ([104, 105, 106, 107, 108, 150].includes(n) || n < 0 || n >= 200) return 'failed';
  return 'sent';
}

module.exports = { sendTelegram, sendSmsRu, getSmsRuStatuses, smsRuDeliveryState };
