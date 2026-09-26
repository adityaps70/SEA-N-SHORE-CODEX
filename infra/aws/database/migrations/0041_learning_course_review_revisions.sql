-- Sea N Shore Learning Studio: reliable course edit → review → resubmit workflow.
-- Safe to run more than once. Adds no destructive changes to existing course data.
--
-- 1. learning_courses.details_revision is an optimistic-concurrency counter for the
--    course details form. Every successful details save increments it, and a save
--    carrying an older revision is rejected instead of silently overwriting newer
--    work (another tab, another LMS manager).
-- 2. learning_course_submissions keeps one row per "Submit for review", with a JSON
--    snapshot of exactly what was submitted and the reviewer's decision and note.
--    Reviewers use it to see what changed since the last review; trainers keep the
--    reviewer's note after they resubmit.

alter table public.learning_courses
  add column if not exists details_revision integer not null default 1;
-- statement-breakpoint

alter table public.learning_courses
  drop constraint if exists learning_courses_details_revision_check,
  add constraint learning_courses_details_revision_check check (details_revision >= 1);
-- statement-breakpoint

create table if not exists public.learning_course_submissions (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz not null default now(),
  details_revision integer not null default 1,
  snapshot jsonb not null default '{}'::jsonb,
  outcome text not null default 'pending',
  reviewer_id uuid references public.profiles(id) on delete set null,
  reviewer_note text,
  reviewed_at timestamptz,
  updated_at timestamptz not null default now()
);
-- statement-breakpoint

alter table public.learning_course_submissions
  drop constraint if exists learning_course_submissions_outcome_check,
  add constraint learning_course_submissions_outcome_check check (
    outcome in ('pending', 'approved', 'changes_requested', 'withdrawn')
  );
-- statement-breakpoint

alter table public.learning_course_submissions
  drop constraint if exists learning_course_submissions_note_check,
  add constraint learning_course_submissions_note_check check (
    reviewer_note is null or char_length(reviewer_note) <= 4000
  );
-- statement-breakpoint

create index if not exists learning_course_submissions_course_idx
  on public.learning_course_submissions (course_id, submitted_at desc, id desc);
-- statement-breakpoint

-- At most one open (pending) submission per course.
create unique index if not exists learning_course_submissions_one_pending_idx
  on public.learning_course_submissions (course_id)
  where outcome = 'pending';
