-- P6 (owner-approved 13 Nov, "Conversion approved for the 3 clear jobs"): old typed "Other" ranks on live jobs that
-- clearly name existing ranks become those ranks. Exactly these three normalised texts, nothing else:
--   "chief engineer"        -> Chief Engineer
--   "master chief officer"  -> Master + Chief Officer   (typed as "Master / Chief officer")
--   "master mariner"        -> Master
-- The text is normalised as normaliseRoleText does (lower case, "&" as "and", anything but a-z 0-9 as one space,
-- trimmed). Every other typed text, including the unclear one, stays exactly as typed.
--
-- Per converted job: the department's "Other" key is removed and the approved ranks added (order kept, no
-- duplicates); the typed text moves to role_other_text_original, word for word; an audit_events row
-- (p6_other_rank_converted) keeps the job's original keys and text so p6_other_rank_conversion_revert.sql can
-- restore them exactly. Then the shared extra-rank links are recounted. updated_at is left alone (a data fix, not an
-- edit). Safe to run more than once: a job already converted (role_other_text_original set) is never touched again.
-- statement-breakpoint
insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
select null, 'p6_other_rank_converted', 'job', j.id::text,
       jsonb_build_object('original_keys', to_jsonb(j.accepted_role_keys), 'original_text', j.role_other_text, 'new_keys', to_jsonb(approved.keys))
from public.jobs j
join (values
  ('chief engineer', array['chief_engineer']::text[]),
  ('master chief officer', array['master', 'chief_officer']::text[]),
  ('master mariner', array['master']::text[])
) as approved(pattern, keys)
  on approved.pattern = btrim(regexp_replace(replace(lower(j.role_other_text), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))
where j.deleted_at is null and j.role_other_text is not null and j.role_other_text_original is null;
-- statement-breakpoint
update public.jobs j
set role_other_text_original = j.role_other_text,
    role_other_text = null,
    accepted_role_keys = array(
      select kept.key from unnest(j.accepted_role_keys) with ordinality as kept(key, position)
      where kept.key not like 'other\_%' order by kept.position
    ) || array(
      select added.key from unnest(approved.keys) with ordinality as added(key, position)
      where not (added.key = any(j.accepted_role_keys)) order by added.position
    )
from (values
  ('chief engineer', array['chief_engineer']::text[]),
  ('master chief officer', array['master', 'chief_officer']::text[]),
  ('master mariner', array['master']::text[])
) as approved(pattern, keys)
where approved.pattern = btrim(regexp_replace(replace(lower(j.role_other_text), '&', ' and '), '[^a-z0-9]+', ' ', 'g'))
  and j.deleted_at is null and j.role_other_text is not null and j.role_other_text_original is null;
-- statement-breakpoint
insert into public.job_department_extra_ranks as link (department_key, role_key, times_used)
select j.department_key, key, count(*)::int
from public.jobs j
cross join lateral unnest(j.accepted_role_keys) as key
join public.maritime_ranks r on r.code = key
where j.deleted_at is null and j.department_key is not null and r.department_key <> j.department_key
group by j.department_key, key
on conflict (department_key, role_key) do update set times_used = excluded.times_used, updated_at = now();
-- statement-breakpoint
update public.job_department_extra_ranks link
set times_used = (
      select count(*)::int from public.jobs j
      where j.department_key = link.department_key and j.deleted_at is null and link.role_key = any(j.accepted_role_keys)
    ),
    updated_at = now();
