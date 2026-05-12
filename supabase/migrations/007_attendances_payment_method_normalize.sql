-- Normalize attendances.payment_method and constrain it to known values.
--
-- Background: a single record was found in production with payment_method = ' Наличные'
-- (leading space). The strict equality check `m === 'Наличные'` in the finance
-- dashboard then excluded that revenue from Cash/Bank balances while still
-- counting it toward Net Profit, producing a phantom discrepancy. Root cause was
-- a free-text input in the admin attendance edit modal; that input has now been
-- replaced with a <select>. This migration cleans up any legacy bad rows and
-- adds a database-level guard so the same class of bug cannot return through
-- another writer (manual SQL, future API endpoints, imports, etc).

-- 1. Trim whitespace; coalesce empty string to NULL.
update attendances
set    payment_method = nullif(btrim(payment_method), '')
where  payment_method is distinct from nullif(btrim(payment_method), '');

-- 2. Enforce the canonical set going forward.
alter table attendances
  drop constraint if exists attendances_payment_method_check;

alter table attendances
  add constraint attendances_payment_method_check
  check (payment_method is null
         or payment_method in ('Наличные', 'Карта', 'Перевод'));
