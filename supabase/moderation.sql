-- Nook: reports, admins, blocking and cleanup.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run AFTER setup.sql and iub-login.sql. It is safe to run again.

-- 1. Admins (people who can see reports, remove files and block) -------------
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins enable row level security;   -- no policies: only changeable here in SQL

-- Your IUB email. Change it if yours is different. Add more admins the same way.
insert into public.admins (email) values ('2320619@iub.edu.bd') on conflict do nothing;

-- 2. Blocked people ------------------------------------------------------------
create table if not exists public.blocked (
  email      text primary key check (email = lower(email)),
  reason     text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
alter table public.blocked enable row level security;

-- 3. Helpers --------------------------------------------------------------------
create or replace function public.my_email()
returns text language sql stable as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins where email = public.my_email())
$$;

-- An IUB student who is not blocked. Every Nook rule already uses this.
create or replace function public.is_iub()
returns boolean language sql stable security definer set search_path = public as $$
  select public.my_email() like '%@iub.edu.bd'
     and not exists (select 1 from public.blocked where email = public.my_email())
$$;

-- What the page asks when you open Nook
create or replace function public.my_status()
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'blocked', exists (select 1 from public.blocked where email = public.my_email()),
    'admin', public.is_admin()
  )
$$;

drop policy if exists "admins manage blocked" on public.blocked;
create policy "admins manage blocked" on public.blocked
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- 4. Reports --------------------------------------------------------------------
alter table public.shares add column if not exists hidden boolean not null default false;

create table if not exists public.reports (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz not null default now(),
  share_id     uuid not null references public.shares (id) on delete cascade,
  reporter     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  reason       text not null check (reason in ('not-study', 'offensive', 'copyright', 'spam', 'other')),
  sender_email text,          -- filled in automatically, only admins can read reports
  unique (share_id, reporter)
);
alter table public.reports enable row level security;

drop policy if exists "students report" on public.reports;
create policy "students report" on public.reports
  for insert to authenticated
  with check (public.is_iub() and reporter = auth.uid());

drop policy if exists "admins read reports" on public.reports;
create policy "admins read reports" on public.reports
  for select to authenticated using (public.is_admin());

drop policy if exists "admins clear reports" on public.reports;
create policy "admins clear reports" on public.reports
  for delete to authenticated using (public.is_admin());

-- Save who sent the reported file (for blocking), and hide a file once 3 people report it
create or replace function public.on_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.sender_email := (
    select lower(u.email) from auth.users u
    join public.shares s on s.from_id = u.id
    where s.id = new.share_id
  );
  return new;
end;
$$;
drop trigger if exists reports_fill on public.reports;
create trigger reports_fill before insert on public.reports
  for each row execute function public.on_report();

create or replace function public.after_report()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select count(distinct reporter) from public.reports where share_id = new.share_id) >= 3 then
    update public.shares set hidden = true where id = new.share_id;
  end if;
  return null;
end;
$$;
drop trigger if exists reports_hide on public.reports;
create trigger reports_hide after insert on public.reports
  for each row execute function public.after_report();

-- 5. Updated rules for shared files --------------------------------------------
drop policy if exists "see shares meant for me" on public.shares;
create policy "see shares meant for me" on public.shares
  for select to authenticated
  using (
    (public.is_iub()
      and (not hidden or from_id = auth.uid())
      and (to_id is null or to_id = auth.uid() or from_id = auth.uid()))
    or (public.is_admin() and exists (select 1 from public.reports r where r.share_id = shares.id))
  );

drop policy if exists "admins remove any share" on public.shares;
create policy "admins remove any share" on public.shares
  for delete to authenticated using (public.is_admin());

drop policy if exists "admins unhide shares" on public.shares;
create policy "admins unhide shares" on public.shares
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "nook admins open reported files" on storage.objects;
create policy "nook admins open reported files" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'materials' and public.is_admin()
    and exists (
      select 1 from public.shares s join public.reports r on r.share_id = s.id
      where s.path = storage.objects.name
    )
  );

drop policy if exists "nook admins delete files" on storage.objects;
create policy "nook admins delete files" on storage.objects
  for delete to authenticated using (bucket_id = 'materials' and public.is_admin());

-- 6. Storage and cleanup (admin only) ------------------------------------------
create or replace function public.storage_used()
returns json language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return json_build_object(
    'bytes', coalesce((select sum(size) from public.shares where kind = 'file'), 0),
    'files', (select count(*) from public.shares where kind = 'file'),
    'notes', (select count(*) from public.shares where kind = 'note'),
    'old',   (select count(*) from public.shares where created_at < now() - interval '30 days')
  );
end;
$$;

create or replace function public.old_share_paths(n_days int default 30)
returns table (id uuid, path text) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query select s.id, s.path from public.shares s where s.created_at < now() - make_interval(days => n_days);
end;
$$;

create or replace function public.delete_old_shares(n_days int default 30)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  delete from public.shares where created_at < now() - make_interval(days => n_days);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- 7. Blocked people can't sign up again either -----------------------------------
create or replace function public.hook_iub_only(event jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  new_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if new_email not like '%@iub.edu.bd' then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Only IUB email addresses (@iub.edu.bd) can join Nook.'));
  end if;
  if exists (select 1 from public.blocked b where b.email = new_email) then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'This account has been blocked from Nook.'));
  end if;
  return '{}'::jsonb;
end;
$$;
grant execute on function public.hook_iub_only to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
grant select on public.blocked to supabase_auth_admin;
revoke execute on function public.hook_iub_only from authenticated, anon, public;
