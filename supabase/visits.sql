-- Nook: visit history for admins.
-- Records who came into the library and for how long: email, avatar name, start and
-- last seen. Students can't read it; only admins can, through the Visitors tab.
-- Kept for 90 days, then deleted automatically.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
-- Run AFTER moderation.sql. It is safe to run again.

create table if not exists public.visits (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users (id) on delete cascade,
  email      text not null,
  name       text not null default '' check (char_length(name) <= 40),
  started_at timestamptz not null default now(),
  last_seen  timestamptz not null default now()
);
create index if not exists visits_user_seen on public.visits (user_id, last_seen desc);
create index if not exists visits_started on public.visits (started_at desc);

-- No policies: nobody can read or change this table directly.
-- The functions below are the only way in.
alter table public.visits enable row level security;
revoke all on public.visits from anon, authenticated;

-- You walked in (or came back). Carries on your last visit if it was under
-- 5 minutes ago, so a quick reload or app switch doesn't count as a new visit.
create or replace function public.visit_start(n text)
returns bigint language plpgsql security definer set search_path = public as $$
declare v bigint;
begin
  if not public.is_iub() then return null; end if;
  select id into v from public.visits
    where user_id = auth.uid() and last_seen > now() - interval '5 minutes'
    order by last_seen desc limit 1;
  if v is not null then
    update public.visits set last_seen = now(), name = left(coalesce(n, ''), 40) where id = v;
  else
    insert into public.visits (user_id, email, name)
      values (auth.uid(), public.my_email(), left(coalesce(n, ''), 40))
      returning id into v;
  end if;
  -- tidy up: forget visits older than 90 days
  delete from public.visits where last_seen < now() - interval '90 days';
  return v;
end;
$$;

-- "Still here", sent once a minute. Returns false if the visit went stale
-- (then the page starts a new one).
create or replace function public.visit_ping(v bigint, n text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  update public.visits set last_seen = now(), name = left(coalesce(n, ''), 40)
    where id = v and user_id = auth.uid() and last_seen > now() - interval '5 minutes';
  return found;
end;
$$;

-- Admin: one row per student
create or replace function public.admin_visitors(n_days int default 30)
returns table (
  email text, google_name text, name text, visits bigint, minutes bigint,
  first_seen timestamptz, last_seen timestamptz, online boolean
) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select v.email,
           max(u.raw_user_meta_data ->> 'full_name') as google_name,
           (array_agg(v.name order by v.last_seen desc))[1] as name,
           count(*) as visits,
           sum(ceil(extract(epoch from (v.last_seen - v.started_at)) / 60))::bigint as minutes,
           min(v.started_at) as first_seen,
           max(v.last_seen) as last_seen,
           max(v.last_seen) > now() - interval '2 minutes' as online
    from public.visits v
    left join auth.users u on u.id = v.user_id
    where v.last_seen > now() - make_interval(days => n_days)
    group by v.email
    order by max(v.last_seen) desc;
end;
$$;

-- Admin: the latest visits, one row each
create or replace function public.admin_recent_visits(n_limit int default 100)
returns table (email text, name text, started_at timestamptz, last_seen timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'not allowed'; end if;
  return query
    select v.email, v.name, v.started_at, v.last_seen
    from public.visits v
    order by v.started_at desc
    limit least(greatest(n_limit, 1), 500);
end;
$$;

revoke execute on function public.visit_start(text) from anon, public;
revoke execute on function public.visit_ping(bigint, text) from anon, public;
revoke execute on function public.admin_visitors(int) from anon, public;
revoke execute on function public.admin_recent_visits(int) from anon, public;
grant execute on function public.visit_start(text) to authenticated;
grant execute on function public.visit_ping(bigint, text) to authenticated;
grant execute on function public.admin_visitors(int) to authenticated;
grant execute on function public.admin_recent_visits(int) to authenticated;
