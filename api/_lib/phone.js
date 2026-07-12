'use strict';

// Normalize the formats commonly entered in Russia to E.164.  International
// numbers must include their country code.  A 10-digit local number is treated
// as Russian because the salon operates in Samara.
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const digits = raw.replace(/\D/g, '');
  if (digits.length === 10) return '+7' + digits;
  if (digits.length === 11 && digits[0] === '8') return '+7' + digits.slice(1);
  if (digits.length === 11 && digits[0] === '7') return '+' + digits;

  if (raw.startsWith('+') && /^[1-9][0-9]{7,14}$/.test(digits)) {
    return '+' + digits;
  }
  return null;
}

function smsRuPhone(phoneE164) {
  return String(phoneE164 || '').replace(/^\+/, '');
}

function maskPhone(phoneE164) {
  const value = String(phoneE164 || '');
  if (value.length < 8) return value;
  return value.slice(0, 4) + '•••' + value.slice(-4);
}

module.exports = { normalizePhone, smsRuPhone, maskPhone };
