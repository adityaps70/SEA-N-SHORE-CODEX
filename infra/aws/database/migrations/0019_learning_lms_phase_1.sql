-- Sea N Shore native LMS Phase 1: first-class curriculum materials, release controls, assignments and SCORM.

alter table public.learning_courses
  add column if not exists navigation_mode text not null default 'free';
-- statement-breakpoint

alter table public.learning_courses
  drop constraint if exists learning_courses_navigation_mode_check;
-- statement-breakpoint

alter table public.learning_courses
  add constraint learning_courses_navigation_mode_check check (navigation_mode in ('free', 'sequential'));
-- statement-breakpoint

alter table public.learning_lessons
  drop constraint if exists learning_lessons_type_check;
-- statement-breakpoint

alter table public.learning_lessons
  add constraint learning_lessons_type_check check (
    lesson_type in (
      'video',
      'article',
      'image',
      'pdf',
      'presentation_document',
      'audio',
      'external_embed',
      'quiz',
      'assignment',
      'downloadable_resource',
      'scorm',
      'live_session'
    )
  );
-- statement-breakpoint

alter table public.learning_lessons
  add column if not exists is_published boolean not null default true,
  add column if not exists release_mode text not null default 'immediate',
  add column if not exists release_at timestamptz,
  add column if not exists drip_delay_days integer,
  add column if not exists prerequisite_lesson_id uuid references public.learning_lessons(id) on delete set null,
  add column if not exists completion_rule text,
  add column if not exists completion_threshold integer,
  add column if not exists max_attempts integer,
  add column if not exists embed_kind text;
-- statement-breakpoint

update public.learning_lessons
set completion_rule = case
  when lesson_type in ('video', 'audio') then 'media_percentage'
  when lesson_type = 'quiz' then 'quiz_pass'
  when lesson_type = 'assignment' then 'assignment_submit'
  when lesson_type = 'scorm' then 'scorm_completion'
  else 'manual'
end,
completion_threshold = case when lesson_type in ('video', 'audio') then 90 else completion_threshold end
where completion_rule is null;
-- statement-breakpoint

alter table public.learning_lessons
  alter column completion_rule set default 'manual',
  alter column completion_rule set not null;
-- statement-breakpoint

alter table public.learning_lessons
  drop constraint if exists learning_lessons_release_mode_check,
  drop constraint if exists learning_lessons_release_shape_check,
  drop constraint if exists learning_lessons_completion_rule_check,
  drop constraint if exists learning_lessons_completion_threshold_check,
  drop constraint if exists learning_lessons_max_attempts_check,
  drop constraint if exists learning_lessons_prerequisite_self_check,
  drop constraint if exists learning_lessons_embed_kind_check;
-- statement-breakpoint

alter table public.learning_lessons
  add constraint learning_lessons_release_mode_check check (release_mode in ('immediate', 'scheduled', 'drip')),
  add constraint learning_lessons_release_shape_check check (
    (release_mode = 'immediate' and release_at is null and drip_delay_days is null)
    or (release_mode = 'scheduled' and release_at is not null and drip_delay_days is null)
    or (release_mode = 'drip' and release_at is null and drip_delay_days is not null and drip_delay_days >= 0)
  ),
  add constraint learning_lessons_completion_rule_check check (
    completion_rule in ('manual', 'view', 'media_percentage', 'quiz_pass', 'assignment_submit', 'scorm_completion')
  ),
  add constraint learning_lessons_completion_threshold_check check (
    completion_threshold is null or completion_threshold between 1 and 100
  ),
  add constraint learning_lessons_max_attempts_check check (max_attempts is null or max_attempts > 0),
  add constraint learning_lessons_prerequisite_self_check check (prerequisite_lesson_id is null or prerequisite_lesson_id <> id),
  add constraint learning_lessons_embed_kind_check check (
    embed_kind is null or embed_kind in ('youtube', 'vimeo', 'generic')
  );
-- statement-breakpoint

create index if not exists learning_lessons_prerequisite_idx
  on public.learning_lessons (prerequisite_lesson_id);
-- statement-breakpoint

alter table public.learning_progress
  add column if not exists viewed_at timestamptz,
  add column if not exists media_percent integer not null default 0,
  add column if not exists attempts_used integer not null default 0;
-- statement-breakpoint

alter table public.learning_progress
  drop constraint if exists learning_progress_media_percent_check,
  drop constraint if exists learning_progress_attempts_used_check;
-- statement-breakpoint

alter table public.learning_progress
  add constraint learning_progress_media_percent_check check (media_percent between 0 and 100),
  add constraint learning_progress_attempts_used_check check (attempts_used >= 0);
-- statement-breakpoint

create table if not exists public.learning_assignments (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.learning_lessons(id) on delete cascade,
  instructions text not null,
  accepted_extensions text[] not null default '{}',
  max_upload_bytes bigint not null default 10485760,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_assignments_instructions_check check (
    instructions = btrim(instructions) and char_length(instructions) between 1 and 12000
  ),
  constraint learning_assignments_extensions_check check (cardinality(accepted_extensions) <= 20),
  constraint learning_assignments_max_upload_check check (max_upload_bytes between 1 and 104857600)
);
-- statement-breakpoint

create table if not exists public.learning_assignment_attempts (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references public.learning_assignments(id) on delete cascade,
  lesson_id uuid not null references public.learning_lessons(id) on delete cascade,
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null,
  response_text text,
  attachment_path text,
  submitted_at timestamptz not null default now(),
  constraint learning_assignment_attempt_number_check check (attempt_number > 0),
  constraint learning_assignment_attempt_response_check check (
    response_text is not null or attachment_path is not null
  ),
  constraint learning_assignment_attempt_text_check check (
    response_text is null or char_length(response_text) <= 50000
  ),
  constraint learning_assignment_attempt_attachment_check check (
    attachment_path is null or char_length(attachment_path) between 1 and 1024
  )
);
-- statement-breakpoint

create unique index if not exists learning_assignment_attempt_number_uq
  on public.learning_assignment_attempts (enrollment_id, lesson_id, attempt_number);
-- statement-breakpoint

create index if not exists learning_assignment_attempts_learner_idx
  on public.learning_assignment_attempts (learner_id, submitted_at desc, id desc);
-- statement-breakpoint

create table if not exists public.learning_scorm_packages (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.learning_lessons(id) on delete cascade,
  source_zip_path text not null,
  extracted_prefix text,
  manifest_path text,
  launch_path text,
  scorm_version text,
  status text not null default 'processing',
  processing_error text,
  manifest_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_scorm_packages_source_check check (char_length(source_zip_path) between 1 and 1024),
  constraint learning_scorm_packages_version_check check (
    scorm_version is null or scorm_version in ('1.2', '2004')
  ),
  constraint learning_scorm_packages_status_check check (
    status in ('processing', 'ready', 'error')
  ),
  constraint learning_scorm_packages_error_check check (
    processing_error is null or char_length(processing_error) <= 8000
  )
);
-- statement-breakpoint

create table if not exists public.learning_scorm_attempts (
  id uuid primary key default gen_random_uuid(),
  package_id uuid not null references public.learning_scorm_packages(id) on delete cascade,
  lesson_id uuid not null references public.learning_lessons(id) on delete cascade,
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  attempt_number integer not null,
  completion_status text not null default 'unknown',
  success_status text not null default 'unknown',
  score_raw numeric(10,3),
  score_scaled numeric(8,5),
  location text,
  suspend_data text,
  session_time_seconds integer not null default 0,
  total_time_seconds integer not null default 0,
  exit_value text,
  initialized_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint learning_scorm_attempt_number_check check (attempt_number > 0),
  constraint learning_scorm_completion_status_check check (
    completion_status in ('unknown', 'not attempted', 'incomplete', 'completed', 'passed', 'failed')
  ),
  constraint learning_scorm_success_status_check check (
    success_status in ('unknown', 'passed', 'failed')
  ),
  constraint learning_scorm_score_scaled_check check (
    score_scaled is null or score_scaled between -1 and 1
  ),
  constraint learning_scorm_time_check check (session_time_seconds >= 0 and total_time_seconds >= 0),
  constraint learning_scorm_location_check check (location is null or char_length(location) <= 4000),
  constraint learning_scorm_suspend_check check (suspend_data is null or char_length(suspend_data) <= 200000),
  constraint learning_scorm_exit_check check (exit_value is null or char_length(exit_value) <= 120)
);
-- statement-breakpoint

create unique index if not exists learning_scorm_attempt_number_uq
  on public.learning_scorm_attempts (enrollment_id, lesson_id, attempt_number);
-- statement-breakpoint

create index if not exists learning_scorm_attempts_learner_idx
  on public.learning_scorm_attempts (learner_id, updated_at desc, id desc);
