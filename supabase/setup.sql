-- Nook: database setup for Supabase.
-- Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- It is safe to run again; it skips things that already exist.

-- 1. Shared study material (files and notes) ---------------------------------
create table if not exists public.shares (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  from_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  from_name   text not null check (char_length(from_name) between 1 and 16),
  to_id       uuid references auth.users (id) on delete cascade,   -- null = everyone
  to_name     text check (char_length(to_name) <= 16),
  kind        text not null check (kind in ('file', 'note')),
  name        text not null check (char_length(name) between 1 and 120),
  note        text check (char_length(note) <= 4000),
  path        text unique,                                        -- where the file sits in storage
  size        integer check (size between 1 and 10485760),        -- 10 MB
  mime        text,
  check ((kind = 'note' and note is not null and path is null)
      or (kind = 'file' and path is not null and size is not null))
);

create index if not exists shares_created_at on public.shares (created_at desc);

alter table public.shares enable row level security;

-- You can see a share if it is for everyone, sent to you, or sent by you.
drop policy if exists "see shares meant for me" on public.shares;
create policy "see shares meant for me" on public.shares
  for select to authenticated
  using (to_id is null or to_id = auth.uid() or from_id = auth.uid());

-- You can only share as yourself, and a file must live in your own folder.
drop policy if exists "share as myself" on public.shares;
create policy "share as myself" on public.shares
  for insert to authenticated
  with check (
    from_id = auth.uid()
    and (path is null or split_part(path, '/', 1) = auth.uid()::text)
  );

-- You can remove what you shared.
drop policy if exists "remove my shares" on public.shares;
create policy "remove my shares" on public.shares
  for delete to authenticated
  using (from_id = auth.uid());

-- Send new shares to open pages live (each person still only gets what RLS allows).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'shares'
  ) then
    alter publication supabase_realtime add table public.shares;
  end if;
end $$;

-- 2. Private bucket for the files --------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'materials', 'materials', false, 10485760,
  array[
    'application/pdf', 'text/plain', 'text/markdown',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png', 'image/jpeg', 'image/webp',
    'application/zip', 'application/x-zip-compressed'
  ]
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Upload only into your own folder: materials/<your id>/...
drop policy if exists "nook upload to my folder" on storage.objects;
create policy "nook upload to my folder" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);

-- Download a file only if you uploaded it or it was shared with you / everyone.
drop policy if exists "nook download allowed files" on storage.objects;
create policy "nook download allowed files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.shares s
        where s.path = storage.objects.name
          and (s.to_id is null or s.to_id = auth.uid())
      )
    )
  );

-- Delete only your own files.
drop policy if exists "nook delete my files" on storage.objects;
create policy "nook delete my files" on storage.objects
  for delete to authenticated
  using (bucket_id = 'materials' and (storage.foldername(name))[1] = auth.uid()::text);
