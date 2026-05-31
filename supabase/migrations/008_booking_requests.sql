create table if not exists booking_requests (
    id bigserial primary key,
    created_at timestamptz not null default now(),
    service_id bigint references services(id) on delete set null,
    service_name text,
    master_id bigint references masters(id) on delete set null,
    master_name text,
    help_choosing boolean not null default false,
    preferred_day text,
    preferred_period text,
    client_name text not null,
    client_contact text not null,
    contact_method text,
    note text,
    status text not null default 'new',
    source text not null default 'public_site',
    ip text,
    user_agent text
);

create index if not exists idx_booking_requests_created_at on booking_requests(created_at);
create index if not exists idx_booking_requests_ip_created on booking_requests(ip, created_at);

alter table booking_requests enable row level security;
-- No anon policies (service-role only)
