create table public.user_learning_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  schema_version integer not null default 1 check (schema_version = 1),
  progress jsonb not null
    default '{"completed":[],"confidence":{}}'::jsonb
    check (jsonb_typeof(progress) = 'object'),
  preferences jsonb not null
    default '{"showPronunciation":true,"autoplay":false}'::jsonb
    check (jsonb_typeof(preferences) = 'object'),
  saved_words text[] not null default '{}',
  updated_at timestamptz not null default now()
);

comment on table public.user_learning_state is
  'One private PracticalTelugu learning snapshot per authenticated user.';

alter table public.user_learning_state enable row level security;

revoke all on table public.user_learning_state from anon;
grant select, insert, update, delete
  on table public.user_learning_state
  to authenticated;

create policy "Users can read their own learning state"
  on public.user_learning_state
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can create their own learning state"
  on public.user_learning_state
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can update their own learning state"
  on public.user_learning_state
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users can delete their own learning state"
  on public.user_learning_state
  for delete
  to authenticated
  using ((select auth.uid()) = user_id);

create function public.touch_user_learning_state_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.touch_user_learning_state_updated_at() from public;

create trigger touch_user_learning_state_updated_at
before update on public.user_learning_state
for each row
execute function public.touch_user_learning_state_updated_at();
