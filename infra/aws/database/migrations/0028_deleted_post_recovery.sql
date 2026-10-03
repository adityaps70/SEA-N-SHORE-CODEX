alter table public.posts
  add column deleted_by uuid references public.profiles(id) on delete set null,
  add column deletion_reason text,
  add column purge_after timestamptz;
-- statement-breakpoint
update public.posts p
set
  deleted_by = coalesce((
    select ma.actor_id
    from public.moderation_actions ma
    where ma.target_type = 'post'
      and ma.target_id = p.id
      and ma.action = 'remove'
      and ma.created_at <= p.deleted_at + interval '5 minutes'
    order by ma.created_at desc, ma.id desc
    limit 1
  ), p.author_id),
  deletion_reason = coalesce((
    select nullif(btrim(ma.note), '')
    from public.moderation_actions ma
    where ma.target_type = 'post'
      and ma.target_id = p.id
      and ma.action = 'remove'
      and ma.created_at <= p.deleted_at + interval '5 minutes'
    order by ma.created_at desc, ma.id desc
    limit 1
  ), 'Deleted by post author.'),
  purge_after = p.deleted_at + interval '30 days'
where p.deleted_at is not null;
-- statement-breakpoint
alter table public.posts
  add constraint posts_deletion_reason_check check (
    deletion_reason is null
    or (
      deletion_reason = btrim(deletion_reason)
      and char_length(deletion_reason) between 1 and 4000
    )
  );
-- statement-breakpoint
alter table public.posts
  add constraint posts_deletion_metadata_check check (
    (
      deleted_at is null
      and deleted_by is null
      and deletion_reason is null
      and purge_after is null
    )
    or (
      deleted_at is not null
      and deletion_reason is not null
      and purge_after is not null
      and purge_after >= deleted_at
    )
  );
-- statement-breakpoint
create index posts_deleted_purge_idx
  on public.posts (purge_after asc, deleted_at asc, id asc)
  where deleted_at is not null;
