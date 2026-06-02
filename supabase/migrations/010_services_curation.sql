alter table services add column if not exists display_order int not null default 100;
alter table services add column if not exists is_public boolean not null default true;
