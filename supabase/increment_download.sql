-- CloudDrop: count downloads.
-- Row Level Security lets students change only their own rows, so a student
-- cannot bump the counter on someone else's file directly. This function runs
-- with the owner's rights, does exactly one thing, and only for signed-in users.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.

create or replace function public.increment_download(file_id uuid)
returns integer
language sql
security definer
set search_path = public
as $$
  update public.files
     set download_count = coalesce(download_count, 0) + 1
   where id = file_id
     and auth.uid() is not null
  returning download_count;
$$;

revoke all on function public.increment_download(uuid) from public, anon;
grant execute on function public.increment_download(uuid) to authenticated;
