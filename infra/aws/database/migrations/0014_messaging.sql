create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  type text not null default 'direct',
  direct_user_low_id uuid not null references public.profiles(id) on delete cascade,
  direct_user_high_id uuid not null references public.profiles(id) on delete cascade,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (direct_user_low_id, direct_user_high_id),
  constraint conversations_type_check check (type = 'direct'),
  constraint conversations_not_self check (direct_user_low_id <> direct_user_high_id),
  constraint conversations_canonical_pair check (direct_user_low_id < direct_user_high_id)
);
-- statement-breakpoint
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_profile_id uuid not null references public.profiles(id) on delete cascade,
  client_message_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  unique (sender_profile_id, client_message_id),
  unique (conversation_id, id),
  constraint messages_body_check check (
    body = btrim(body)
    and char_length(body) between 1 and 5000
  )
);
-- statement-breakpoint
alter table public.conversations
  add constraint conversations_last_message_fk
  foreign key (last_message_id)
  references public.messages(id)
  on delete set null;
-- statement-breakpoint
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_read_message_id uuid references public.messages(id) on delete set null,
  last_read_at timestamptz,
  muted_at timestamptz,
  archived_at timestamptz,
  primary key (conversation_id, profile_id)
);
-- statement-breakpoint
create index conversation_participants_profile_idx
  on public.conversation_participants (profile_id, conversation_id);
-- statement-breakpoint
create index conversations_last_message_idx
  on public.conversations (last_message_at desc, id desc);
-- statement-breakpoint
create index messages_conversation_cursor_idx
  on public.messages (conversation_id, created_at desc, id desc)
  where deleted_at is null;
-- statement-breakpoint
create or replace function private.set_conversation_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
-- statement-breakpoint
create trigger conversations_set_updated_at
before update on public.conversations
for each row execute procedure private.set_conversation_updated_at();
