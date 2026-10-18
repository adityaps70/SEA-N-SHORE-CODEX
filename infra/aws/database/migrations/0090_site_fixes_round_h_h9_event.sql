-- Sea N Shore site fixes round H, H9 follow-up. One idempotent data step, approved by the owner (18 Oct 2026).
--
-- The cancelled internal event "Sea N shore portal — discussion and brainstorming as how to market" leaves every public
-- list (removed_at). Migration 0087 tried this, but its title pattern matched no row. This match compares the title
-- with spaces and punctuation removed, so "brain storming", dashes or a different separator still match. The test
-- course was already removed by 0087 and is not touched here.
--
-- Safe to run more than once: the update matches only events not yet removed. On a database without the event (local
-- and test databases) nothing changes. The guard refuses before anything changes if the match finds more than one live
-- event. The previous values are kept in one audit_events row (action site_fixes.round_h.h9_event) so the change can be
-- reversed: removed_at back to null.

do $$
begin
  if (
    select count(*) from public.events
    where regexp_replace(lower(title), '[^a-z]', '', 'g') like '%portal%brainstorm%market%' and removed_at is null
  ) > 1 then
    raise exception 'Round H H9 refused: more than one live event matches the internal brainstorming event';
  end if;
end
$$;
-- statement-breakpoint

insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
select
  null,
  'site_fixes.round_h.h9_event',
  'data_fix',
  'round_h_h9_event',
  jsonb_build_object(
    'fix', 'round H H9 internal event',
    'internal_events', coalesce((
      select jsonb_agg(jsonb_build_object('id', event.id, 'status', event.status, 'removed_at', event.removed_at) order by event.id)
      from public.events event
      where regexp_replace(lower(event.title), '[^a-z]', '', 'g') like '%portal%brainstorm%market%' and event.removed_at is null
    ), '[]'::jsonb)
  )
where exists (
  select 1 from public.events event
  where regexp_replace(lower(event.title), '[^a-z]', '', 'g') like '%portal%brainstorm%market%' and event.removed_at is null
);
-- statement-breakpoint

update public.events set removed_at = now(), updated_at = now() where regexp_replace(lower(title), '[^a-z]', '', 'g') like '%portal%brainstorm%market%' and removed_at is null;
