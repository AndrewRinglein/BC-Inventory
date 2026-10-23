-- Pictures shown in the hall TV rotation. Public to read (the TV just loads the URL);
-- only signed-in staff can add or remove them. Images only, up to 15 MB.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tv-art', 'tv-art', true, 15728640, array['image/webp','image/jpeg','image/png','image/gif'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy "tv art: staff upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'tv-art');
create policy "tv art: staff remove" on storage.objects for delete to authenticated
  using (bucket_id = 'tv-art');
