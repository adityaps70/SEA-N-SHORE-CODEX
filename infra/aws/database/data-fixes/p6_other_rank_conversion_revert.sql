-- P6: undoes p6_other_rank_conversion.sql. Each converted job (role_other_text_original set) gets back the accepted
-- ranks recorded in its latest p6_other_rank_converted audit row and its typed text, word for word; the kept-text
-- column is cleared, an audit row (p6_other_rank_reverted) is written, and the shared extra-rank links are recounted.
-- A rank a poster changed on the job after the conversion is replaced by the original ranks.
-- Safe to run more than once: a job not converted (role_other_text_original empty) is never touched.
-- statement-breakpoint
insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
select null, 'p6_other_rank_reverted', 'job', j.id::text,
       jsonb_build_object('reverted_keys', to_jsonb(j.accepted_role_keys), 'restored_keys', converted.metadata -> 'original_keys')
from public.jobs j
join (
  select distinct on (target_id) target_id, metadata from public.audit_events
  where action = 'p6_other_rank_converted' and target_type = 'job'
  order by target_id, id desc
) as converted on converted.target_id = j.id::text
where j.role_other_text_original is not null;
-- statement-breakpoint
update public.jobs j
set accepted_role_keys = array(select jsonb_array_elements_text(converted.metadata -> 'original_keys')),
    role_other_text = j.role_other_text_original,
    role_other_text_original = null
from (
  select distinct on (target_id) target_id, metadata from public.audit_events
  where action = 'p6_other_rank_converted' and target_type = 'job'
  order by target_id, id desc
) as converted
where converted.target_id = j.id::text and j.role_other_text_original is not null;
-- statement-breakpoint
update public.job_department_extra_ranks link
set times_used = (
      select count(*)::int from public.jobs j
      where j.department_key = link.department_key and j.deleted_at is null and link.role_key = any(j.accepted_role_keys)
    ),
    updated_at = now();
