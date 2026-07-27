alter table public.user_learning_state
add column revision bigint not null default 0
check (revision >= 0);

comment on column public.user_learning_state.revision is
  'Optimistic concurrency revision used to merge progress from multiple devices.';
