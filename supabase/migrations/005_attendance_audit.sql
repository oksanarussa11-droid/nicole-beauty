-- 005_attendance_audit.sql
-- Soft delete + edit timestamp on attendances; new audit table for admin actions.

alter table attendances
  add column if not exists deleted_at timestamptz,
  add column if not exists edited_at  timestamptz;

create index if not exists attendances_deleted_at_idx on attendances (deleted_at);

create table if not exists attendance_audit (
  id            bigserial primary key,
  attendance_id bigint not null,
  action        text   not null check (action in ('create_retro','update','delete','restore')),
  actor         text   not null default 'admin',
  actor_ip      text,
  before        jsonb,
  after         jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);

create index if not exists attendance_audit_att_idx     on attendance_audit (attendance_id);
create index if not exists attendance_audit_created_idx on attendance_audit (created_at desc);

alter table attendance_audit enable row level security;
-- No anon/authenticated policies => default deny. Only service-role reads/writes.
