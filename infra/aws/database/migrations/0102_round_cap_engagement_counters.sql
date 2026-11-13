-- Round CAP (owner-approved 13 Nov, ₹0): engagement counters kept on write, so feed reads stop counting rows.
-- post_stats (0083) already keeps each post's total reactions, comments and reposts. Still counted on every read:
-- each post's reactions by type, each poll option's votes and each comment's reactions by type. Three counter tables
-- now hold those, kept by triggers on insert, delete and the update that changes a reaction's type or a vote's option.
-- The counts mean exactly what the reads counted before (every row, no filter), proven on PGlite against the previous
-- SQL in engagement-counters.integration.test.ts.
--
-- Additive and safe to run more than once: three new tables, their functions and triggers, and a backfill that only
-- inserts rows that do not exist yet. Creating each trigger takes a short lock on its table, so no write lands
-- between the trigger and the backfill (the tables are small: hundreds of rows). The ranking worker's nightly
-- reconcile corrects any drift and logs how many counters it fixed.
--
-- A counter must never fail a member's like, vote, comment or delete: every bump runs inside its own exception
-- block, so an error there (a deadlock, or anything unforeseen) is logged as a warning and the member's write goes
-- ahead; the nightly reconcile then repairs that counter. A vote change bumps its two options in a fixed order (by
-- id), so two members changing votes in opposite directions cannot deadlock on them.
-- Reversible: drop the three triggers, the three *_on_* functions, the three *_bump functions and the three tables.
-- statement-breakpoint
create table if not exists public.post_reaction_counts (
  post_id uuid primary key references public.posts(id) on delete cascade,
  like_count integer not null default 0 check (like_count >= 0),
  support_count integer not null default 0 check (support_count >= 0),
  respect_count integer not null default 0 check (respect_count >= 0),
  on_point_count integer not null default 0 check (on_point_count >= 0),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists public.comment_reaction_counts (
  comment_id uuid primary key references public.post_comments(id) on delete cascade,
  like_count integer not null default 0 check (like_count >= 0),
  support_count integer not null default 0 check (support_count >= 0),
  respect_count integer not null default 0 check (respect_count >= 0),
  on_point_count integer not null default 0 check (on_point_count >= 0),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create table if not exists public.post_poll_option_counts (
  option_id uuid primary key references public.post_poll_options(id) on delete cascade,
  votes integer not null default 0 check (votes >= 0),
  updated_at timestamptz not null default now()
);
-- statement-breakpoint
create or replace function public.post_reaction_counts_bump(target uuid, kind public.post_reaction_type, delta integer)
returns void
language sql
as $$
  insert into public.post_reaction_counts as c (post_id, like_count, support_count, respect_count, on_point_count, updated_at)
  select target,
         case when kind = 'like' then greatest(delta, 0) else 0 end,
         case when kind = 'support' then greatest(delta, 0) else 0 end,
         case when kind = 'respect' then greatest(delta, 0) else 0 end,
         case when kind = 'on_point' then greatest(delta, 0) else 0 end,
         now()
  where exists (select 1 from public.posts p where p.id = target)
  on conflict (post_id) do update set
    like_count = greatest(c.like_count + case when kind = 'like' then delta else 0 end, 0),
    support_count = greatest(c.support_count + case when kind = 'support' then delta else 0 end, 0),
    respect_count = greatest(c.respect_count + case when kind = 'respect' then delta else 0 end, 0),
    on_point_count = greatest(c.on_point_count + case when kind = 'on_point' then delta else 0 end, 0),
    updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.comment_reaction_counts_bump(target uuid, kind public.post_reaction_type, delta integer)
returns void
language sql
as $$
  insert into public.comment_reaction_counts as c (comment_id, like_count, support_count, respect_count, on_point_count, updated_at)
  select target,
         case when kind = 'like' then greatest(delta, 0) else 0 end,
         case when kind = 'support' then greatest(delta, 0) else 0 end,
         case when kind = 'respect' then greatest(delta, 0) else 0 end,
         case when kind = 'on_point' then greatest(delta, 0) else 0 end,
         now()
  where exists (select 1 from public.post_comments pc where pc.id = target)
  on conflict (comment_id) do update set
    like_count = greatest(c.like_count + case when kind = 'like' then delta else 0 end, 0),
    support_count = greatest(c.support_count + case when kind = 'support' then delta else 0 end, 0),
    respect_count = greatest(c.respect_count + case when kind = 'respect' then delta else 0 end, 0),
    on_point_count = greatest(c.on_point_count + case when kind = 'on_point' then delta else 0 end, 0),
    updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.post_poll_option_counts_bump(target uuid, delta integer)
returns void
language sql
as $$
  insert into public.post_poll_option_counts as c (option_id, votes, updated_at)
  select target, greatest(delta, 0), now()
  where exists (select 1 from public.post_poll_options o where o.id = target)
  on conflict (option_id) do update set votes = greatest(c.votes + delta, 0), updated_at = now()
$$;
-- statement-breakpoint
create or replace function public.post_reaction_counts_on_reaction() returns trigger
language plpgsql
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.post_reaction_counts_bump(new.post_id, new.reaction_type, 1);
    elsif tg_op = 'DELETE' then
      perform public.post_reaction_counts_bump(old.post_id, old.reaction_type, -1);
    elsif old.post_id is distinct from new.post_id or old.reaction_type is distinct from new.reaction_type then
      perform public.post_reaction_counts_bump(old.post_id, old.reaction_type, -1);
      perform public.post_reaction_counts_bump(new.post_id, new.reaction_type, 1);
    end if;
  exception when others then
    -- Never fail the member's write; the nightly reconcile repairs the counter.
    raise warning 'engagement_counter_bump_failed table=post_reactions sqlstate=%', sqlstate;
  end;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger post_reaction_counts_reactions
  after insert or delete or update of post_id, reaction_type on public.post_reactions
  for each row execute function public.post_reaction_counts_on_reaction();
-- statement-breakpoint
create or replace function public.comment_reaction_counts_on_reaction() returns trigger
language plpgsql
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.comment_reaction_counts_bump(new.comment_id, new.reaction_type, 1);
    elsif tg_op = 'DELETE' then
      perform public.comment_reaction_counts_bump(old.comment_id, old.reaction_type, -1);
    elsif old.comment_id is distinct from new.comment_id or old.reaction_type is distinct from new.reaction_type then
      perform public.comment_reaction_counts_bump(old.comment_id, old.reaction_type, -1);
      perform public.comment_reaction_counts_bump(new.comment_id, new.reaction_type, 1);
    end if;
  exception when others then
    raise warning 'engagement_counter_bump_failed table=comment_reactions sqlstate=%', sqlstate;
  end;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger comment_reaction_counts_reactions
  after insert or delete or update of comment_id, reaction_type on public.comment_reactions
  for each row execute function public.comment_reaction_counts_on_reaction();
-- statement-breakpoint
create or replace function public.post_poll_option_counts_on_vote() returns trigger
language plpgsql
as $$
begin
  begin
    if tg_op = 'INSERT' then
      perform public.post_poll_option_counts_bump(new.option_id, 1);
    elsif tg_op = 'DELETE' then
      perform public.post_poll_option_counts_bump(old.option_id, -1);
    elsif old.option_id is distinct from new.option_id then
      -- Lower id first, so two opposite vote changes lock the two counters in the same order.
      if old.option_id < new.option_id then
        perform public.post_poll_option_counts_bump(old.option_id, -1);
        perform public.post_poll_option_counts_bump(new.option_id, 1);
      else
        perform public.post_poll_option_counts_bump(new.option_id, 1);
        perform public.post_poll_option_counts_bump(old.option_id, -1);
      end if;
    end if;
  exception when others then
    raise warning 'engagement_counter_bump_failed table=post_poll_votes sqlstate=%', sqlstate;
  end;
  return null;
end
$$;
-- statement-breakpoint
create or replace trigger post_poll_option_counts_votes
  after insert or delete or update of option_id on public.post_poll_votes
  for each row execute function public.post_poll_option_counts_on_vote();
-- statement-breakpoint
-- One-time backfill for what already exists (the triggers keep the counts current from here on).
insert into public.post_reaction_counts (post_id, like_count, support_count, respect_count, on_point_count)
select r.post_id,
       (count(*) filter (where r.reaction_type = 'like'))::int,
       (count(*) filter (where r.reaction_type = 'support'))::int,
       (count(*) filter (where r.reaction_type = 'respect'))::int,
       (count(*) filter (where r.reaction_type = 'on_point'))::int
from public.post_reactions r
group by r.post_id
on conflict (post_id) do nothing;
-- statement-breakpoint
insert into public.comment_reaction_counts (comment_id, like_count, support_count, respect_count, on_point_count)
select r.comment_id,
       (count(*) filter (where r.reaction_type = 'like'))::int,
       (count(*) filter (where r.reaction_type = 'support'))::int,
       (count(*) filter (where r.reaction_type = 'respect'))::int,
       (count(*) filter (where r.reaction_type = 'on_point'))::int
from public.comment_reactions r
group by r.comment_id
on conflict (comment_id) do nothing;
-- statement-breakpoint
insert into public.post_poll_option_counts (option_id, votes)
select v.option_id, count(*)::int
from public.post_poll_votes v
group by v.option_id
on conflict (option_id) do nothing;
