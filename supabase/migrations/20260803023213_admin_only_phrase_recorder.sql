-- The family recorder is an owner-only administrative surface. Restore the
-- database boundary after the temporary public-by-link recorder migration.

do $migration$
declare
  owner_email_hash constant text :=
    'c9159cf1b16f8787da86a4799533b24c6a96171d43b8d7c2a11231215ebe715c';
  admin_user_id uuid;
  admin_match_count integer;
  legacy_recording_owner_id uuid;
  legacy_recording_owner_count integer;
begin
  select
    count(*)::integer,
    (array_agg(users.id order by users.id))[1]
  into admin_match_count, admin_user_id
  from auth.users as users
  where encode(
    extensions.digest(lower(coalesce(users.email, '')), 'sha256'),
    'hex'
  ) = owner_email_hash;

  -- Fail closed first. Only an unambiguous registered owner is reactivated.
  update public.recorder_members
  set active = false;

  if admin_match_count = 1 then
    insert into public.recorder_members (user_id, role, active)
    values (admin_user_id, 'owner', true)
    on conflict (user_id) do update
      set role = 'owner', active = true;

    select
      count(distinct recordings.user_id)::integer,
      (array_agg(distinct recordings.user_id))[1]
    into legacy_recording_owner_count, legacy_recording_owner_id
    from public.phrase_recordings as recordings;

    -- There is no safe attribution when recordings came from multiple users.
    -- In that case they remain readable only to the owner, but are not blessed
    -- as owner-authored. Physical storage paths are intentionally unchanged.
    if legacy_recording_owner_count = 1 then
      update public.phrase_recordings
      set user_id = admin_user_id
      where user_id = legacy_recording_owner_id;
    end if;
  end if;
end;
$migration$;

-- Re-check the canonical auth.users row when claiming access. A signed JWT
-- email alone must not be able to activate a different recorder member.
create or replace function public.claim_phrase_recorder_access()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_user_id uuid := auth.uid();
  owner_email_hash constant text :=
    'c9159cf1b16f8787da86a4799533b24c6a96171d43b8d7c2a11231215ebe715c';
  registered_owner_id uuid;
  registered_owner_count integer;
begin
  if requester_user_id is null then
    return null;
  end if;

  select
    count(*)::integer,
    (array_agg(users.id order by users.id))[1]
  into registered_owner_count, registered_owner_id
  from auth.users as users
  where encode(
    extensions.digest(lower(coalesce(users.email, '')), 'sha256'),
    'hex'
  ) = owner_email_hash;

  if registered_owner_count <> 1 or registered_owner_id <> requester_user_id then
    return null;
  end if;

  update public.recorder_members
  set active = false
  where user_id <> requester_user_id;

  insert into public.recorder_members (user_id, role, active)
  values (requester_user_id, 'owner', true)
  on conflict (user_id) do update
    set role = 'owner', active = true;

  return 'owner';
end;
$$;

revoke all on function public.claim_phrase_recorder_access() from public;
grant execute on function public.claim_phrase_recorder_access()
  to authenticated;

drop policy if exists "Users can read their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can add their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can update their own phrase recordings"
  on public.phrase_recordings;
drop policy if exists "Users can delete their own phrase recordings"
  on public.phrase_recordings;

revoke all on table public.phrase_recordings from anon;
grant select, insert, update, delete
  on table public.phrase_recordings
  to authenticated;

-- The owner may read legacy rows whose original anonymous user no longer owns
-- the administrative recorder session.
create policy "Active owner can read phrase recordings"
  on public.phrase_recordings
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can add phrase recordings"
  on public.phrase_recordings
  for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and split_part(storage_path, '/', 1) = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can update phrase recordings"
  on public.phrase_recordings
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  )
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can delete phrase recordings"
  on public.phrase_recordings
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

drop policy if exists "Users can read their own phrase audio"
  on storage.objects;
drop policy if exists "Users can upload their own phrase audio"
  on storage.objects;
drop policy if exists "Users can update their own phrase audio"
  on storage.objects;
drop policy if exists "Users can remove their own phrase audio"
  on storage.objects;

-- The owner may read or manage legacy objects without renaming their physical
-- paths. New uploads must always live beneath the current owner's auth UID.
create policy "Active owner can read phrase audio"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can upload phrase audio"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and (storage.foldername(name))[2] ~ '^phrase-[a-z0-9]+$'
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can update phrase audio"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  )
  with check (
    bucket_id = 'phrase-recordings'
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );

create policy "Active owner can remove phrase audio"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and exists (
      select 1
      from public.recorder_members as members
      where members.user_id = (select auth.uid())
        and members.role = 'owner'
        and members.active
    )
  );
