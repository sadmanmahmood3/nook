-- Nook: IUB-only access. Run this once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run it AFTER setup.sql. It is safe to run again.

-- 1. A helper: is the signed-in person using an @iub.edu.bd account? ----------
create or replace function public.is_iub()
returns boolean
language sql
stable
as $$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@iub.edu.bd'
$$;

-- 2. Shared files and notes: IUB students only ------------------------------
drop policy if exists "see shares meant for me" on public.shares;
create policy "see shares meant for me" on public.shares
  for select to authenticated
  using (public.is_iub() and (to_id is null or to_id = auth.uid() or from_id = auth.uid()));

drop policy if exists "share as myself" on public.shares;
create policy "share as myself" on public.shares
  for insert to authenticated
  with check (
    public.is_iub()
    and from_id = auth.uid()
    and (path is null or split_part(path, '/', 1) = auth.uid()::text)
  );

drop policy if exists "remove my shares" on public.shares;
create policy "remove my shares" on public.shares
  for delete to authenticated
  using (public.is_iub() and from_id = auth.uid());

-- 3. The files themselves: IUB students only --------------------------------
drop policy if exists "nook upload to my folder" on storage.objects;
create policy "nook upload to my folder" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'materials' and public.is_iub()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "nook download allowed files" on storage.objects;
create policy "nook download allowed files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials' and public.is_iub()
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.shares s
        where s.path = storage.objects.name
          and (s.to_id is null or s.to_id = auth.uid())
      )
    )
  );

drop policy if exists "nook delete my files" on storage.objects;
create policy "nook delete my files" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'materials' and public.is_iub()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- 4. The live library (who is here, movement): IUB students only -------------
drop policy if exists "nook iub can receive" on realtime.messages;
create policy "nook iub can receive" on realtime.messages
  for select to authenticated
  using (public.is_iub());

drop policy if exists "nook iub can send" on realtime.messages;
create policy "nook iub can send" on realtime.messages
  for insert to authenticated
  with check (public.is_iub());

-- 5. Block sign-ups that are not @iub.edu.bd (turned on under Authentication -> Hooks)
create or replace function public.hook_iub_only(event jsonb)
returns jsonb
language plpgsql
as $$
declare
  email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if email not like '%@iub.edu.bd' then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'Only IUB email addresses (@iub.edu.bd) can join Nook.'
      )
    );
  end if;
  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_iub_only to supabase_auth_admin;
revoke execute on function public.hook_iub_only from authenticated, anon, public;

-- 6. Clean up the test data from before IUB login (anonymous test users) ------
delete from public.shares
where from_id in (select id from auth.users where is_anonymous);
