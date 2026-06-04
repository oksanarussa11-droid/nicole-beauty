-- Public Storage bucket for master profile photos, uploaded from the admin panel.
-- Mirrors the salon-gallery bucket policies (anon write, public read).
-- next.config already whitelists /storage/v1/object/public/** for next/image.

insert into storage.buckets (id, name, public)
  values ('master-photos', 'master-photos', true)
  on conflict (id) do nothing;

drop policy if exists "master_photos_public_read" on storage.objects;
create policy "master_photos_public_read" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'master-photos');

drop policy if exists "master_photos_anon_write" on storage.objects;
create policy "master_photos_anon_write" on storage.objects
  for all to anon
  using (bucket_id = 'master-photos')
  with check (bucket_id = 'master-photos');

drop policy if exists "master_photos_authed_write" on storage.objects;
create policy "master_photos_authed_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'master-photos')
  with check (bucket_id = 'master-photos');
