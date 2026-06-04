-- Salon gallery: admin-editable photos shown on the public site.
-- Same column conventions as masters/services (display_order + is_public).

create table if not exists salon_gallery (
  id            bigserial primary key,
  image_url     text,
  caption       text,
  tag           text,
  display_order int not null default 100,
  is_public     boolean not null default true,
  created_at    timestamptz not null default now()
);

create index if not exists idx_salon_gallery_order on salon_gallery(display_order, id);

-- Open anon policy — matches the existing masters/services trust model
-- (the admin panel writes with the public anon key).
alter table salon_gallery enable row level security;

drop policy if exists "anon_all_salon_gallery" on salon_gallery;
create policy "anon_all_salon_gallery" on salon_gallery for all to anon using (true) with check (true);
drop policy if exists "authed_all_salon_gallery" on salon_gallery;
create policy "authed_all_salon_gallery" on salon_gallery for all to authenticated using (true) with check (true);

-- Seed the current placeholder captions/tags (no image yet) so the gallery
-- looks identical until the admin uploads real photos.
insert into salon_gallery (caption, tag, display_order) values
  ('Зона стрижки и укладки', 'Волосы',    10),
  ('Маникюрный кабинет',     'Ногти',     20),
  ('Уютная зона ожидания',   'Интерьер',  30),
  ('Кабинет солярия',        'Солярий',   40),
  ('Ресепшен и приём гостей','Интерьер',  50);

-- ============ STORAGE BUCKET ============
-- Public bucket for gallery images. next.config already whitelists
-- /storage/v1/object/public/** for next/image optimization.

insert into storage.buckets (id, name, public)
  values ('salon-gallery', 'salon-gallery', true)
  on conflict (id) do nothing;

-- Public read for anyone; writes allowed for the anon role (same trust model
-- as the gallery table above). Scoped to this bucket only.
drop policy if exists "salon_gallery_public_read" on storage.objects;
create policy "salon_gallery_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'salon-gallery');

drop policy if exists "salon_gallery_anon_write" on storage.objects;
create policy "salon_gallery_anon_write" on storage.objects
  for all to anon
  using (bucket_id = 'salon-gallery')
  with check (bucket_id = 'salon-gallery');

drop policy if exists "salon_gallery_authed_write" on storage.objects;
create policy "salon_gallery_authed_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'salon-gallery')
  with check (bucket_id = 'salon-gallery');
