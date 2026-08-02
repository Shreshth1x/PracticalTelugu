create extension if not exists pgcrypto with schema extensions;

create table public.recorder_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'recorder'
    check (role in ('owner', 'recorder', 'reviewer')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

comment on table public.recorder_members is
  'Explicit allowlist for the private PracticalTelugu family recorder.';

alter table public.recorder_members enable row level security;

revoke all on table public.recorder_members from anon, authenticated;
grant select on table public.recorder_members to authenticated;

create policy "Recorder members can read their own access"
  on public.recorder_members
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create function public.claim_phrase_recorder_access()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester_email_hash text;
begin
  if auth.uid() is null then
    return null;
  end if;

  requester_email_hash := encode(
    extensions.digest(
      lower(coalesce(auth.jwt() ->> 'email', '')),
      'sha256'
    ),
    'hex'
  );

  if requester_email_hash <> 'c9159cf1b16f8787da86a4799533b24c6a96171d43b8d7c2a11231215ebe715c' then
    return null;
  end if;

  insert into public.recorder_members (user_id, role, active)
  values (auth.uid(), 'owner', true)
  on conflict (user_id) do update
    set role = 'owner', active = true;

  return 'owner';
end;
$$;

revoke all on function public.claim_phrase_recorder_access() from public;
grant execute on function public.claim_phrase_recorder_access()
  to authenticated;

create table public.phrase_recordings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  recording_key text not null
    check (char_length(recording_key) between 1 and 120),
  phrase_telugu text not null check (char_length(phrase_telugu) > 0),
  phrase_roman text not null check (char_length(phrase_roman) > 0),
  phrase_english text not null check (char_length(phrase_english) > 0),
  speaker_name text not null
    check (char_length(speaker_name) between 1 and 60),
  storage_path text not null unique,
  mime_type text not null check (mime_type like 'audio/%'),
  byte_size integer not null check (byte_size between 1 and 10485760),
  duration_ms integer not null check (duration_ms between 200 and 60000),
  consent_confirmed_at timestamptz not null,
  status text not null default 'ready'
    check (status in ('ready', 'archived')),
  created_at timestamptz not null default now()
);

comment on table public.phrase_recordings is
  'Private family voice takes captured for PracticalTelugu phrase audio.';

create index phrase_recordings_user_target_created_idx
  on public.phrase_recordings (user_id, recording_key, created_at desc);

alter table public.phrase_recordings enable row level security;

revoke all on table public.phrase_recordings from anon;
grant select, insert, update, delete
  on table public.phrase_recordings
  to authenticated;

create policy "Users can read their own phrase recordings"
  on public.phrase_recordings
  for select
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can add their own phrase recordings"
  on public.phrase_recordings
  for insert
  to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can update their own phrase recordings"
  on public.phrase_recordings
  for update
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  )
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can delete their own phrase recordings"
  on public.phrase_recordings
  for delete
  to authenticated
  using (
    (select auth.uid()) = user_id
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'phrase-recordings',
  'phrase-recordings',
  false,
  10485760,
  array[
    'audio/webm',
    'audio/mp4',
    'audio/x-m4a',
    'audio/ogg',
    'audio/mpeg',
    'audio/wav',
    'audio/wave'
  ]
)
on conflict (id) do nothing;

create policy "Users can read their own phrase audio"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can upload their own phrase audio"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can update their own phrase audio"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  )
  with check (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );

create policy "Users can remove their own phrase audio"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'phrase-recordings'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and exists (
      select 1
      from public.recorder_members
      where recorder_members.user_id = (select auth.uid())
        and recorder_members.active
    )
  );
