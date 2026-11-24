-- CloudDrop: saved files, reports, activity log and live updates.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to run again.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ---------- Saved files (bookmarks) ----------
create table if not exists public.bookmarks (
  user_id uuid not null references auth.users (id) on delete cascade,
  file_id uuid not null references public.files (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, file_id)
);
alter table public.bookmarks enable row level security;
drop policy if exists "own bookmarks" on public.bookmarks;
create policy "own bookmarks" on public.bookmarks
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---------- Reports of wrong or broken files ----------
create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  file_id uuid not null references public.files (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  reason text not null check (reason in ('wrong-subject', 'broken', 'duplicate', 'inappropriate')),
  status text not null default 'open' check (status in ('open', 'dismissed', 'removed')),
  created_at timestamptz not null default now(),
  unique (file_id, reporter_id)
);
alter table public.reports enable row level security;
drop policy if exists "file a report" on public.reports;
create policy "file a report" on public.reports
  for insert to authenticated
  with check (reporter_id = auth.uid());
drop policy if exists "see own or all as admin" on public.reports;
create policy "see own or all as admin" on public.reports
  for select to authenticated
  using (reporter_id = auth.uid() or public.is_admin());
drop policy if exists "admins review" on public.reports;
create policy "admins review" on public.reports
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Admins may remove any file the queue says should go.
drop policy if exists "admins delete files" on public.files;
create policy "admins delete files" on public.files
  for delete to authenticated
  using (public.is_admin());
drop policy if exists "admins delete objects" on storage.objects;
create policy "admins delete objects" on storage.objects
  for delete to authenticated
  using (bucket_id = 'resources' and public.is_admin());

-- ---------- Activity log, written by triggers only ----------
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('upload', 'download', 'delete', 'report')),
  file_id uuid,
  file_title text,
  actor_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.activity enable row level security;
drop policy if exists "admins read activity" on public.activity;
create policy "admins read activity" on public.activity
  for select to authenticated
  using (public.is_admin());

create or replace function public.log_file_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activity (kind, file_id, file_title, actor_id) values ('upload', new.id, new.title, new.uploader_id);
    return new;
  end if;
  insert into public.activity (kind, file_id, file_title, actor_id) values ('delete', old.id, old.title, auth.uid());
  return old;
end;
$$;
drop trigger if exists files_activity on public.files;
create trigger files_activity after insert or delete on public.files
  for each row execute function public.log_file_activity();

create or replace function public.log_report_activity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.activity (kind, file_id, file_title, actor_id)
  select 'report', new.file_id, f.title, new.reporter_id from public.files f where f.id = new.file_id;
  return new;
end;
$$;
drop trigger if exists reports_activity on public.reports;
create trigger reports_activity after insert on public.reports
  for each row execute function public.log_report_activity();

-- The download counter now also writes to the log.
create or replace function public.increment_download(file_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  counted integer;
  title text;
begin
  if auth.uid() is null then
    return null;
  end if;
  update public.files f
     set download_count = coalesce(f.download_count, 0) + 1
   where f.id = increment_download.file_id
  returning f.download_count, f.title into counted, title;
  if counted is not null then
    insert into public.activity (kind, file_id, file_title, actor_id) values ('download', increment_download.file_id, title, auth.uid());
  end if;
  return counted;
end;
$$;
revoke all on function public.increment_download(uuid) from public, anon;
grant execute on function public.increment_download(uuid) to authenticated;

-- ---------- Live updates: stream changes to the files table ----------
do $$
begin
  alter publication supabase_realtime add table public.files;
exception when duplicate_object then null;
end;
$$;

-- Tell the API layer about the new tables straight away.
notify pgrst, 'reload schema';
