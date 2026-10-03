-- Sea N Shore jobs lifecycle reliability.
-- Draft -> Published -> Archived (status 'closed') -> Deleted (soft delete).
-- Additive and safe to run more than once: existing jobs and applications keep their current values.

-- Soft delete keeps applications, status history and moderation evidence intact for the
-- people who applied, while hiding the job from search and from the hiring workspace.
alter table public.jobs
  add column if not exists archived_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null;
-- statement-breakpoint

-- Backfill archived_at for jobs that were archived before this migration.
update public.jobs
set archived_at = updated_at
where status = 'closed'::public.job_listing_status
  and archived_at is null;
-- statement-breakpoint

-- Optional message from the applicant to the employer, captured with Easy Apply.
alter table public.job_applications
  add column if not exists cover_note text;
-- statement-breakpoint

alter table public.job_applications
  drop constraint if exists job_applications_cover_note_check,
  add constraint job_applications_cover_note_check check (
    cover_note is null
    or (cover_note = btrim(cover_note) and char_length(cover_note) between 1 and 2000)
  );
-- statement-breakpoint

-- Hiring workspace lists a poster's own jobs; keep that lookup cheap and skip deleted rows.
create index if not exists jobs_created_by_active_idx
  on public.jobs (created_by_user_id, created_at desc, id desc)
  where deleted_at is null;
-- statement-breakpoint

create index if not exists jobs_company_active_idx
  on public.jobs (company_id, created_at desc, id desc)
  where deleted_at is null;
