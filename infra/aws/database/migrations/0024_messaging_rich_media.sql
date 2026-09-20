alter table public.messages
  add column reply_to_message_id uuid,
  add column attachment_storage_path text,
  add column attachment_name text,
  add column attachment_mime_type text,
  add column attachment_size bigint;
-- statement-breakpoint
alter table public.messages
  drop constraint messages_body_check,
  add constraint messages_body_check check (
    body = btrim(body)
    and char_length(body) <= 5000
    and (deleted_at is not null or char_length(body) >= 1 or attachment_storage_path is not null)
  ),
  add constraint messages_attachment_check check (
    (
      attachment_storage_path is null
      and attachment_name is null
      and attachment_mime_type is null
      and attachment_size is null
    )
    or
    (
      attachment_storage_path is not null
      and attachment_name is not null
      and attachment_mime_type is not null
      and attachment_size is not null
      and attachment_size > 0
      and char_length(attachment_storage_path) <= 700
      and char_length(attachment_name) between 1 and 255
      and char_length(attachment_mime_type) between 1 and 160
    )
  ),
  add constraint messages_reply_to_message_fk
    foreign key (reply_to_message_id)
    references public.messages(id)
    on delete set null;
-- statement-breakpoint
create index messages_reply_to_message_idx
  on public.messages (reply_to_message_id)
  where reply_to_message_id is not null;
-- statement-breakpoint
create table public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, profile_id),
  constraint message_reactions_emoji_check check (
    char_length(emoji) between 1 and 32
  )
);
