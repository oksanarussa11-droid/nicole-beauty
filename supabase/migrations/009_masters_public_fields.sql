alter table masters add column if not exists photo_url text;
alter table masters add column if not exists bio text;
alter table masters add column if not exists display_order int not null default 100;
alter table masters add column if not exists is_public boolean not null default true;

drop view if exists masters_public;
create or replace view masters_public as
  select id, name, specialty, active, photo_url, bio, display_order, is_public, created_at
  from masters;

grant select on masters_public to anon, authenticated;
