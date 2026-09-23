alter table public.content_reports
  alter column reporter_id drop not null;
-- statement-breakpoint
alter table public.content_reports
  drop constraint if exists content_reports_target_type_target_id_reporter_id_key;
-- statement-breakpoint
create unique index if not exists content_reports_member_target_reporter_unique_idx
  on public.content_reports (target_type, target_id, reporter_id)
  where reporter_id is not null;
-- statement-breakpoint
create unique index if not exists content_reports_automated_active_unique_idx
  on public.content_reports (target_type, target_id, reason)
  where reporter_id is null
    and status in ('open', 'reviewing');
