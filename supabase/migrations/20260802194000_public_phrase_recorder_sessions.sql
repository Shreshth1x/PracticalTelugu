-- Recording is open to anyone with the direct link. Supabase anonymous auth
-- supplies an invisible per-browser user id so clips can remain private and
-- owner-scoped without asking the speaker to create an account.

drop policy if exists "Users can read their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can add their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can update their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can delete their own phrase recordings"
  on public.phrase_recordings;

create policy "Users can read their own phrase recordings"
  on public.phrase_recordings
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can add their own phrase recordings"
  on public.phrase_recordings
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own phrase recordings"
  on public.phrase_recordings
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own phrase recordings"
  on public.phrase_recordings
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can read their own phrase audio"
  on storage.objects;
drop policy if exists "Users can upload their own phrase audio"
  on storage.objects;
drop policy if exists "Users can update their own phrase audio"
  on storage.objects;
drop policy if exists "Users can remove their own phrase audio"
  on storage.objects;

create policy "Users can read their own phrase audio"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
  );

create policy "Users can upload their own phrase audio"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
  );

create policy "Users can update their own phrase audio"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
  )
  with check (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
  );

create policy "Users can remove their own phrase audio"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
  );

update storage.buckets
set file_size_limit = 2097152
where id = 'phrase-recordings';
