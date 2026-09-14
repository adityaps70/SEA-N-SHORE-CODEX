-- Sea N Shore Learning certificates: immutable evidence for completed certificate-enabled enrollments.

create table if not exists public.learning_certificates (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null unique references public.learning_enrollments(id) on delete restrict,
  course_id uuid not null references public.learning_courses(id) on delete restrict,
  learner_id uuid not null references public.profiles(id) on delete restrict,
  certificate_number text not null unique default (
    'SNS-' || to_char(current_date, 'YYYY') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))
  ),
  verification_code uuid not null unique default gen_random_uuid(),
  learner_name text not null,
  course_title text not null,
  mentor_name text not null,
  completed_at timestamptz not null,
  issued_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint learning_certificates_number_check check (
    certificate_number ~ '^SNS-[0-9]{4}-[A-F0-9]{12}$'
  ),
  constraint learning_certificates_learner_name_check check (
    learner_name = btrim(learner_name) and char_length(learner_name) between 2 and 180
  ),
  constraint learning_certificates_course_title_check check (
    course_title = btrim(course_title) and char_length(course_title) between 4 and 180
  ),
  constraint learning_certificates_mentor_name_check check (
    mentor_name = btrim(mentor_name) and char_length(mentor_name) between 2 and 180
  )
);
-- statement-breakpoint

create index if not exists learning_certificates_learner_idx
  on public.learning_certificates (learner_id, issued_at desc, id desc);
-- statement-breakpoint

create index if not exists learning_certificates_verification_idx
  on public.learning_certificates (verification_code);
