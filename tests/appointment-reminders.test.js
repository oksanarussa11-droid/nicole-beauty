'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizePhone, smsRuPhone, maskPhone } = require('../api/_lib/phone');
const { smsRuDeliveryState } = require('../api/_lib/reminder-providers');
const { buildMessages } = require('../api/appointment-reminders');

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
