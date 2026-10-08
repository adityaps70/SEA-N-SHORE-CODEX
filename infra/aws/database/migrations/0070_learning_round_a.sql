-- Sea N Shore learning round A: editing published courses, assignment uploads, captions,
-- watched time, rich-text lessons and learning notifications.
-- Additive and safe to run more than once: new nullable or defaulted columns, new tables and
-- new indexes only. Existing rows, learner progress, certificates and payments are not changed.
--
-- 1. Draft revisions. A published course is edited through a draft copy (a learning_courses row
--    with revision_of_course_id set). Learners keep using the live course. On approval the draft
--    is applied onto the live rows in place, keyed by revision_source_id, so lesson, section,
--    question and option ids (and the progress and attempts that reference them) never change.
-- 2. Soft delete. A material, section, question or option removed from a live course is hidden
--    with removed_at (and lessons are unpublished) instead of being deleted, so its history stays.
-- 3. Assignment uploads: up to max_files files per attempt in learning_assignment_attachments.
-- 4. Captions (WebVTT), watched time, and the article body format (plain text or sanitized HTML).
-- 5. Learning notifications: email preferences, an idempotent email queue, and markers that keep
--    drip-release and trainer digests from announcing anything twice.

alter table public.learning_courses
  add column if not exists revision_of_course_id uuid references public.learning_courses(id) on delete cascade,
  add column if not exists revision_closed_at timestamptz,
  add column if not exists revision_outcome text;
-- statement-breakpoint

alter table public.learning_courses
  drop constraint if exists learning_courses_revision_outcome_check,
  add constraint learning_courses_revision_outcome_check check (
    (revision_outcome is null and revision_closed_at is null)
    or (revision_outcome in ('merged', 'discarded') and revision_closed_at is not null)
  );
-- statement-breakpoint

alter table public.learning_courses
  drop constraint if exists learning_courses_revision_self_check,
  add constraint learning_courses_revision_self_check check (
    revision_of_course_id is null or revision_of_course_id <> id
  );
-- statement-breakpoint

-- At most one open draft revision per live course.
create unique index if not exists learning_courses_one_open_revision_idx
  on public.learning_courses (revision_of_course_id)
  where revision_of_course_id is not null and revision_closed_at is null;
-- statement-breakpoint

create index if not exists learning_courses_revision_of_idx
  on public.learning_courses (revision_of_course_id, created_at desc)
  where revision_of_course_id is not null;
-- statement-breakpoint

alter table public.learning_course_sections
  add column if not exists removed_at timestamptz,
  add column if not exists revision_source_id uuid references public.learning_course_sections(id) on delete set null;
-- statement-breakpoint

alter table public.learning_lessons
  add column if not exists removed_at timestamptz,
  add column if not exists revision_source_id uuid references public.learning_lessons(id) on delete set null,
  add column if not exists article_format text not null default 'plain',
  add column if not exists caption_path text;
-- statement-breakpoint

alter table public.learning_lessons
  drop constraint if exists learning_lessons_article_format_check,
  drop constraint if exists learning_lessons_caption_path_check,
  drop constraint if exists learning_lessons_removed_unpublished_check;
-- statement-breakpoint

alter table public.learning_lessons
  add constraint learning_lessons_article_format_check check (article_format in ('plain', 'html')),
  add constraint learning_lessons_caption_path_check check (
    caption_path is null or char_length(caption_path) between 1 and 1024
  ),
  add constraint learning_lessons_removed_unpublished_check check (
    removed_at is null or is_published = false
  );
-- statement-breakpoint

create index if not exists learning_lessons_revision_source_idx
  on public.learning_lessons (revision_source_id)
  where revision_source_id is not null;
-- statement-breakpoint

create index if not exists learning_sections_revision_source_idx
  on public.learning_course_sections (revision_source_id)
  where revision_source_id is not null;
-- statement-breakpoint

alter table public.learning_quiz_questions
  add column if not exists removed_at timestamptz,
  add column if not exists revision_source_id uuid references public.learning_quiz_questions(id) on delete set null;
-- statement-breakpoint

alter table public.learning_quiz_options
  add column if not exists removed_at timestamptz,
  add column if not exists revision_source_id uuid references public.learning_quiz_options(id) on delete set null;
-- statement-breakpoint

alter table public.learning_progress
  add column if not exists watched_seconds integer not null default 0,
  add column if not exists furthest_position_seconds integer not null default 0;
-- statement-breakpoint

alter table public.learning_progress
  drop constraint if exists learning_progress_watched_seconds_check,
  add constraint learning_progress_watched_seconds_check check (
    watched_seconds >= 0 and furthest_position_seconds >= 0
  );
-- statement-breakpoint

-- New assignments default to 20 MB; existing assignments keep the limit they store.
alter table public.learning_assignments
  alter column max_upload_bytes set default 20971520;
-- statement-breakpoint

alter table public.learning_assignments
  add column if not exists max_files integer not null default 5;
-- statement-breakpoint

alter table public.learning_assignments
  drop constraint if exists learning_assignments_max_files_check,
  add constraint learning_assignments_max_files_check check (max_files between 1 and 10);
-- statement-breakpoint

alter table public.learning_assignment_attempts
  add column if not exists trainer_digest_at timestamptz;
-- statement-breakpoint

create table if not exists public.learning_assignment_attachments (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.learning_assignment_attempts(id) on delete cascade,
  storage_path text not null,
  file_name text not null,
  content_type text not null,
  size_bytes bigint not null,
  position integer not null,
  created_at timestamptz not null default now(),
  constraint learning_assignment_attachments_path_check check (char_length(storage_path) between 1 and 1024),
  constraint learning_assignment_attachments_name_check check (char_length(file_name) between 1 and 255),
  constraint learning_assignment_attachments_type_check check (char_length(content_type) between 3 and 255),
  constraint learning_assignment_attachments_size_check check (size_bytes > 0 and size_bytes <= 104857600),
  constraint learning_assignment_attachments_position_check check (position between 0 and 9)
);
-- statement-breakpoint

create unique index if not exists learning_assignment_attachments_path_uq
  on public.learning_assignment_attachments (storage_path);
-- statement-breakpoint

create unique index if not exists learning_assignment_attachments_attempt_position_uq
  on public.learning_assignment_attachments (attempt_id, position);
-- statement-breakpoint

alter table public.notifications
  add column if not exists course_id uuid,
  add column if not exists lesson_id uuid,
  add column if not exists details jsonb;
-- statement-breakpoint

alter table public.notifications
  drop constraint if exists notifications_course_fk,
  drop constraint if exists notifications_lesson_fk;
-- statement-breakpoint

alter table public.notifications
  add constraint notifications_course_fk foreign key (course_id) references public.learning_courses(id) on delete cascade,
  add constraint notifications_lesson_fk foreign key (lesson_id) references public.learning_lessons(id) on delete set null;
-- statement-breakpoint

create table if not exists public.notification_email_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  category text not null,
  email_enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, category),
  constraint notification_email_preferences_category_check check (category in ('learning'))
);
-- statement-breakpoint

create table if not exists public.learning_notification_emails (
  id uuid primary key default gen_random_uuid(),
  dedupe_key text not null,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint learning_notification_emails_dedupe_check check (char_length(dedupe_key) between 1 and 300),
  constraint learning_notification_emails_kind_check check (
    kind in (
      'enrolled',
      'lessons_released',
      'assignment_graded',
      'certificate_issued',
      'course_approved',
      'course_changes_requested',
      'submissions_to_grade'
    )
  ),
  constraint learning_notification_emails_status_check check (status in ('pending', 'sent', 'skipped', 'failed')),
  constraint learning_notification_emails_attempts_check check (attempts >= 0),
  constraint learning_notification_emails_error_check check (last_error is null or char_length(last_error) <= 500)
);
-- statement-breakpoint

create unique index if not exists learning_notification_emails_dedupe_uq
  on public.learning_notification_emails (dedupe_key);
-- statement-breakpoint

create index if not exists learning_notification_emails_pending_idx
  on public.learning_notification_emails (next_attempt_at asc, id asc)
  where status = 'pending';
-- statement-breakpoint

-- One row per learner and released lesson, so a drip release is announced exactly once.
create table if not exists public.learning_release_notices (
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  lesson_id uuid not null references public.learning_lessons(id) on delete cascade,
  released_at timestamptz not null,
  noticed_at timestamptz not null default now(),
  primary key (enrollment_id, lesson_id)
);
