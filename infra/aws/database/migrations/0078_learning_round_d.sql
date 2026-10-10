-- Sea N Shore learning round D: batches (cohorts) and live sessions.
--   D1 a course can run as dated batches. A learner buys or enrols into a batch; drip release can follow the batch
--      start date; the roster can be filtered by batch. Self-paced courses (batch_mode 'self_paced', the default for
--      every existing course) work exactly as before.
--   D2 each batch has a session calendar (one-off and weekly recurring sessions with a meeting link), reminder emails
--      1 day and 1 hour before, attendance (join time plus present/absent/excused), an optional minimum attendance for
--      the certificate, and recordings. Times are stored in UTC; a member may store a time zone for emails.
--
-- Additive and safe to run more than once. It relaxes exactly one existing check, as approved for round D:
--   learning_notification_emails.kind also allows 'session_reminder' (every existing kind stays allowed).
-- No existing row is changed: every new column is null or has a default that keeps today's behaviour.

alter table public.profiles
  add column if not exists time_zone text,
  add column if not exists time_zone_source text not null default 'auto';
-- statement-breakpoint

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_time_zone_check') then
    alter table public.profiles
      add constraint profiles_time_zone_check check (
        time_zone is null or (char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$')
      );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_time_zone_source_check') then
    alter table public.profiles
      add constraint profiles_time_zone_source_check check (time_zone_source in ('auto', 'manual'));
  end if;
end $$;
-- statement-breakpoint

alter table public.learning_courses
  add column if not exists batch_mode text not null default 'self_paced',
  add column if not exists drip_anchor text not null default 'enrolment',
  add column if not exists min_attendance_percent smallint;
-- statement-breakpoint

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'learning_courses_batch_mode_check') then
    alter table public.learning_courses
      add constraint learning_courses_batch_mode_check check (batch_mode in ('self_paced', 'batches'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'learning_courses_drip_anchor_check') then
    alter table public.learning_courses
      add constraint learning_courses_drip_anchor_check check (drip_anchor in ('enrolment', 'batch_start'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'learning_courses_min_attendance_check') then
    alter table public.learning_courses
      add constraint learning_courses_min_attendance_check check (
        min_attendance_percent is null or min_attendance_percent between 1 and 100
      );
  end if;
end $$;
-- statement-breakpoint

create table if not exists public.learning_course_batches (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  seat_limit integer,
  time_zone text not null default 'Asia/Kolkata',
  manager_profile_id uuid references public.profiles(id) on delete set null,
  status text not null default 'upcoming',
  enrolment_open boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_course_batches_title_check check (char_length(btrim(title)) between 2 and 120),
  constraint learning_course_batches_dates_check check (ends_at is null or ends_at > starts_at),
  constraint learning_course_batches_seat_limit_check check (seat_limit is null or seat_limit between 1 and 10000),
  constraint learning_course_batches_time_zone_check check (
    char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'
  ),
  constraint learning_course_batches_status_check check (status in ('upcoming', 'running', 'completed', 'archived'))
);
-- statement-breakpoint

create index if not exists learning_course_batches_course_idx
  on public.learning_course_batches (course_id, starts_at);
-- statement-breakpoint

create index if not exists learning_course_batches_manager_idx
  on public.learning_course_batches (manager_profile_id)
  where manager_profile_id is not null;
-- statement-breakpoint

create table if not exists public.learning_batch_instructors (
  batch_id uuid not null references public.learning_course_batches(id) on delete cascade,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  added_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (batch_id, profile_id)
);
-- statement-breakpoint

create index if not exists learning_batch_instructors_profile_idx
  on public.learning_batch_instructors (profile_id);
-- statement-breakpoint

alter table public.learning_enrollments
  add column if not exists batch_id uuid references public.learning_course_batches(id) on delete restrict;
-- statement-breakpoint

create index if not exists learning_enrollments_batch_idx
  on public.learning_enrollments (batch_id, status)
  where batch_id is not null;
-- statement-breakpoint

alter table public.course_payment_orders
  add column if not exists batch_id uuid references public.learning_course_batches(id) on delete restrict;
-- statement-breakpoint

create index if not exists course_payment_orders_batch_idx
  on public.course_payment_orders (batch_id, status)
  where batch_id is not null;
-- statement-breakpoint

alter table public.learning_course_invitations
  add column if not exists batch_id uuid references public.learning_course_batches(id) on delete set null;
-- statement-breakpoint

create table if not exists public.learning_session_series (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.learning_course_batches(id) on delete cascade,
  title text not null,
  weekdays smallint[] not null,
  local_time time not null,
  time_zone text not null,
  duration_minutes smallint not null,
  first_date date not null,
  week_count smallint not null,
  meeting_url text,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint learning_session_series_title_check check (char_length(btrim(title)) between 2 and 160),
  constraint learning_session_series_weekdays_check check (
    cardinality(weekdays) between 1 and 7 and weekdays <@ array[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  constraint learning_session_series_time_zone_check check (
    char_length(time_zone) between 1 and 64 and time_zone ~ '^[A-Za-z][A-Za-z0-9_+/-]*$'
  ),
  constraint learning_session_series_duration_check check (duration_minutes between 5 and 600),
  constraint learning_session_series_weeks_check check (week_count between 1 and 52),
  constraint learning_session_series_url_check check (
    meeting_url is null or (meeting_url ~ '^https://' and char_length(meeting_url) <= 2048)
  )
);
-- statement-breakpoint

create index if not exists learning_session_series_batch_idx
  on public.learning_session_series (batch_id);
-- statement-breakpoint

create table if not exists public.learning_batch_sessions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.learning_course_batches(id) on delete cascade,
  series_id uuid references public.learning_session_series(id) on delete set null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  duration_minutes smallint not null,
  meeting_url text,
  status text not null default 'scheduled',
  cancelled_at timestamptz,
  recording_kind text,
  recording_url text,
  recording_path text,
  recording_content_type text,
  recording_added_at timestamptz,
  recording_added_by uuid references public.profiles(id) on delete set null,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_batch_sessions_title_check check (char_length(btrim(title)) between 2 and 160),
  constraint learning_batch_sessions_description_check check (description is null or char_length(description) <= 2000),
  constraint learning_batch_sessions_duration_check check (duration_minutes between 5 and 600),
  constraint learning_batch_sessions_url_check check (
    meeting_url is null or (meeting_url ~ '^https://' and char_length(meeting_url) <= 2048)
  ),
  constraint learning_batch_sessions_status_check check (status in ('scheduled', 'cancelled')),
  constraint learning_batch_sessions_cancelled_check check ((status = 'cancelled') = (cancelled_at is not null)),
  constraint learning_batch_sessions_recording_check check (
    (recording_kind is null and recording_url is null and recording_path is null and recording_content_type is null)
    or (recording_kind = 'link' and recording_url ~ '^https://' and char_length(recording_url) <= 2048
        and recording_path is null and recording_content_type is null)
    or (recording_kind = 'upload' and recording_path ~ '^learning/' and recording_url is null
        and recording_content_type is not null)
  )
);
-- statement-breakpoint

create index if not exists learning_batch_sessions_batch_idx
  on public.learning_batch_sessions (batch_id, starts_at);
-- statement-breakpoint

create index if not exists learning_batch_sessions_upcoming_idx
  on public.learning_batch_sessions (starts_at)
  where status = 'scheduled';
-- statement-breakpoint

create table if not exists public.learning_session_attendance (
  session_id uuid not null references public.learning_batch_sessions(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  first_joined_at timestamptz,
  last_joined_at timestamptz,
  join_count integer not null default 0,
  status text,
  marked_by uuid references public.profiles(id) on delete set null,
  marked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, learner_id),
  constraint learning_session_attendance_join_count_check check (join_count >= 0),
  constraint learning_session_attendance_status_check check (status is null or status in ('present', 'absent', 'excused')),
  constraint learning_session_attendance_marked_check check ((status is null) = (marked_at is null))
);
-- statement-breakpoint

create index if not exists learning_session_attendance_enrollment_idx
  on public.learning_session_attendance (enrollment_id);
-- statement-breakpoint

alter table public.learning_notification_emails drop constraint if exists learning_notification_emails_kind_check, add constraint learning_notification_emails_kind_check check (kind in ('enrolled', 'lessons_released', 'assignment_graded', 'certificate_issued', 'course_approved', 'course_changes_requested', 'submissions_to_grade', 'quiz_graded', 'certificate_expiring', 'announcement', 'session_reminder'));
