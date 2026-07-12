'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, smsRuPhone, maskPhone } = require('../api/_lib/phone');
const { smsRuDeliveryState } = require('../api/_lib/reminder-providers');
const appointmentReminders = require('../api/appointment-reminders');
const { buildMessages } = appointmentReminders;

function responseRecorder() {
  return {
    statusCode: 0,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(value) { this.body = JSON.parse(value); },
  };
}

test('normalizes Russian phone formats to E.164', () => {
  assert.equal(normalizePhone('8 (999) 123-45-67'), '+79991234567');
  assert.equal(normalizePhone('7 999 123 45 67'), '+79991234567');
  assert.equal(normalizePhone('9991234567'), '+79991234567');
  assert.equal(normalizePhone('+55 11 99999-1234'), '+5511999991234');
  assert.equal(normalizePhone('123'), null);
  assert.equal(smsRuPhone('+79991234567'), '79991234567');
  assert.equal(maskPhone('+79991234567'), '+799•••4567');
});

test('maps SMS.RU provider codes to admin statuses', () => {
  assert.equal(smsRuDeliveryState(100), 'sent');
  assert.equal(smsRuDeliveryState(102), 'sent');
  assert.equal(smsRuDeliveryState(103), 'delivered');
  assert.equal(smsRuDeliveryState(104), 'failed');
  assert.equal(smsRuDeliveryState(202), 'failed');
});

test('builds a localized reminder without exposing internal identifiers', () => {
  const messages = buildMessages({
    appointment_scheduled_at: '2026-07-10T10:00:00.000Z',
    service_name: 'Стрижка',
    master_name: 'Ирина',
  });
  assert.match(messages.telegram, /10\.07 в 14:00/);
  assert.match(messages.telegram, /Стрижка/);
  assert.match(messages.telegram, /Ирина/);
  assert.match(messages.sms, /^Nicole Beauty:/);
});

test('protects Telegram webhook configuration with the cron secret', async () => {
  process.env.CRON_SECRET = 'test-secret';
  const res = responseRecorder();
  await appointmentReminders({ method: 'POST', headers: {}, body: {} }, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: 'Unauthorized' });
});

test('configures Telegram without returning sensitive values', async () => {
  process.env.CRON_SECRET = 'test-secret';
  process.env.TELEGRAM_BOT_TOKEN = 'token-that-must-not-leak';
  process.env.TELEGRAM_WEBHOOK_SECRET = 'webhook-secret-that-must-not-leak';
  const calls = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const result = url.endsWith('/getMe')
      ? { ok: true, result: { id: 123, username: 'nicole_test_bot' } }
      : { ok: true, result: true };
    return { ok: true, json: async () => result };
  };

  try {
    const res = responseRecorder();
    await appointmentReminders({
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
      body: { action: 'configure_telegram_webhook' },
    }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.bot.username, 'nicole_test_bot');
    assert.equal(calls[1].body.secret_token, process.env.TELEGRAM_WEBHOOK_SECRET);
    assert.doesNotMatch(JSON.stringify(res.body), /token-that-must-not-leak|webhook-secret-that-must-not-leak/);
  } finally {
    global.fetch = originalFetch;
  }
});
