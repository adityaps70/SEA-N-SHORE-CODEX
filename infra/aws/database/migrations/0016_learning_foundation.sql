-- Sea N Shore Learning foundation: native mentor, course, enrollment and progress domain.
-- Phase 1 only. Commerce, reviews, assessments, certificates and payout ledgers are deferred.

create table if not exists public.learning_mentor_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  applicant_name text not null,
  current_last_rank text not null,
  years_experience numeric(4,1) not null,
  vessel_types text[] not null default '{}',
  specialization text not null,
  certifications text[] not null default '{}',
  linkedin_url text,
  short_bio text not null,
  profile_photo_path text,
  proposed_course_topics text[] not null default '{}',
  status text not null default 'pending',
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  admin_review_note text,
  constraint learning_mentor_applications_status_check check (
    status in ('pending', 'changes_requested', 'approved', 'rejected')
  ),
  constraint learning_mentor_applications_name_check check (
    applicant_name = btrim(applicant_name) and char_length(applicant_name) between 2 and 120
  ),
  constraint learning_mentor_applications_rank_check check (
    current_last_rank = btrim(current_last_rank) and char_length(current_last_rank) between 2 and 120
  ),
  constraint learning_mentor_applications_experience_check check (
    years_experience between 0 and 70
  ),
  constraint learning_mentor_applications_vessel_types_check check (
    cardinality(vessel_types) between 1 and 20
  ),
  constraint learning_mentor_applications_specialization_check check (
    specialization = btrim(specialization) and char_length(specialization) between 2 and 500
  ),
  constraint learning_mentor_applications_certifications_check check (
    cardinality(certifications) between 1 and 30
  ),
  constraint learning_mentor_applications_linkedin_check check (
    linkedin_url is null or char_length(linkedin_url) between 12 and 320
  ),
  constraint learning_mentor_applications_bio_check check (
    short_bio = btrim(short_bio) and char_length(short_bio) between 40 and 1500
  ),
  constraint learning_mentor_applications_photo_check check (
    profile_photo_path is null or char_length(profile_photo_path) between 1 and 1024
  ),
  constraint learning_mentor_applications_topics_check check (
    cardinality(proposed_course_topics) between 1 and 12
  ),
  constraint learning_mentor_applications_admin_note_check check (
    admin_review_note is null or char_length(admin_review_note) <= 4000
  )
);
-- statement-breakpoint

create unique index if not exists learning_mentor_applications_user_uq
  on public.learning_mentor_applications (user_id);
-- statement-breakpoint

create index if not exists learning_mentor_applications_admin_queue_idx
  on public.learning_mentor_applications (status, submitted_at asc, id asc);
-- statement-breakpoint

create table if not exists public.learning_mentors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  application_id uuid not null references public.learning_mentor_applications(id) on delete restrict,
  status text not null default 'active',
  approved_by uuid not null references public.profiles(id),
  approved_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_mentors_status_check check (
    status in ('active', 'suspended')
  ),
  unique (user_id),
  unique (application_id)
);
-- statement-breakpoint

create table if not exists public.learning_courses (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid not null references public.learning_mentors(id) on delete restrict,
  slug text not null unique,
  title text not null,
  subtitle text,
  description text not null,
  category text not null,
  level text not null,
  language text not null default 'English',
  thumbnail_path text,
  trailer_path text,
  learning_outcomes text[] not null default '{}',
  requirements text[] not null default '{}',
  target_audience text[] not null default '{}',
  price_minor bigint not null default 0,
  discount_price_minor bigint,
  currency varchar(3) not null default 'INR',
  access_type text not null default 'free',
  certificate_enabled boolean not null default true,
  course_format text not null default 'recorded',
  status text not null default 'draft',
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  admin_review_note text,
  approved_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_courses_slug_check check (
    slug = lower(btrim(slug))
    and char_length(slug) between 1 and 120
    and slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'
  ),
  constraint learning_courses_title_check check (
    title = btrim(title) and char_length(title) between 4 and 180
  ),
  constraint learning_courses_subtitle_check check (
    subtitle is null or (subtitle = btrim(subtitle) and char_length(subtitle) between 4 and 240)
  ),
  constraint learning_courses_description_check check (
    description = btrim(description) and char_length(description) between 40 and 12000
  ),
  constraint learning_courses_category_check check (
    category = btrim(category) and char_length(category) between 2 and 120
  ),
  constraint learning_courses_level_check check (
    level in ('beginner', 'intermediate', 'advanced', 'all_levels')
  ),
  constraint learning_courses_language_check check (
    language = btrim(language) and char_length(language) between 2 and 80
  ),
  constraint learning_courses_outcomes_check check (cardinality(learning_outcomes) <= 30),
  constraint learning_courses_requirements_check check (cardinality(requirements) <= 30),
  constraint learning_courses_audience_check check (cardinality(target_audience) <= 30),
  constraint learning_courses_price_check check (
    price_minor >= 0 and discount_price_minor is null or discount_price_minor >= 0
  ),
  constraint learning_courses_discount_check check (
    discount_price_minor is null or discount_price_minor <= price_minor
  ),
  constraint learning_courses_access_check check (
    access_type in ('free', 'paid')
    and ((access_type = 'free' and price_minor = 0) or (access_type = 'paid' and price_minor > 0))
  ),
  constraint learning_courses_format_check check (
    course_format in ('recorded', 'live_cohort', 'hybrid')
  ),
  constraint learning_courses_status_check check (
    status in ('draft', 'submitted', 'changes_requested', 'approved', 'published', 'archived')
  ),
  constraint learning_courses_admin_note_check check (
    admin_review_note is null or char_length(admin_review_note) <= 4000
  )
);
-- statement-breakpoint

create index if not exists learning_courses_marketplace_idx
  on public.learning_courses (status, category, published_at desc, id desc);
-- statement-breakpoint

create index if not exists learning_courses_mentor_idx
  on public.learning_courses (mentor_id, status, updated_at desc, id desc);
-- statement-breakpoint

create table if not exists public.learning_course_sections (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete cascade,
  title text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_course_sections_title_check check (
    title = btrim(title) and char_length(title) between 1 and 180
  ),
  constraint learning_course_sections_position_check check (position >= 0)
);
-- statement-breakpoint

create unique index if not exists learning_sections_course_position_uq
  on public.learning_course_sections (course_id, position);
-- statement-breakpoint

create table if not exists public.learning_lessons (
  id uuid primary key default gen_random_uuid(),
  section_id uuid not null references public.learning_course_sections(id) on delete cascade,
  title text not null,
  lesson_type text not null,
  position integer not null,
  summary text,
  article_body text,
  asset_path text,
  external_url text,
  duration_seconds integer,
  is_preview boolean not null default false,
  is_downloadable boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_lessons_title_check check (
    title = btrim(title) and char_length(title) between 1 and 180
  ),
  constraint learning_lessons_type_check check (
    lesson_type in (
      'video',
      'article',
      'pdf',
      'presentation_document',
      'audio',
      'quiz',
      'assignment',
      'downloadable_resource',
      'live_session'
    )
  ),
  constraint learning_lessons_position_check check (position >= 0),
  constraint learning_lessons_summary_check check (
    summary is null or char_length(summary) <= 2000
  ),
  constraint learning_lessons_article_check check (
    article_body is null or char_length(article_body) <= 100000
  ),
  constraint learning_lessons_asset_check check (
    asset_path is null or char_length(asset_path) between 1 and 1024
  ),
  constraint learning_lessons_external_url_check check (
    external_url is null or char_length(external_url) between 8 and 2048
  ),
  constraint learning_lessons_duration_check check (
    duration_seconds is null or duration_seconds >= 0
  )
);
-- statement-breakpoint

create unique index if not exists learning_lessons_section_position_uq
  on public.learning_lessons (section_id, position);
-- statement-breakpoint

create table if not exists public.learning_enrollments (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.learning_courses(id) on delete restrict,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  enrollment_source text not null default 'free',
  status text not null default 'active',
  enrolled_at timestamptz not null default now(),
  completed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_enrollments_source_check check (
    enrollment_source in ('free', 'purchase', 'admin')
  ),
  constraint learning_enrollments_status_check check (
    status in ('active', 'completed', 'revoked')
  )
);
-- statement-breakpoint

create unique index if not exists learning_enrollments_course_learner_uq
  on public.learning_enrollments (course_id, learner_id);
-- statement-breakpoint

create index if not exists learning_enrollments_learner_idx
  on public.learning_enrollments (learner_id, status, updated_at desc, id desc);
-- statement-breakpoint

create table if not exists public.learning_progress (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  lesson_id uuid not null references public.learning_lessons(id) on delete cascade,
  completed boolean not null default false,
  completed_at timestamptz,
  last_position_seconds integer not null default 0,
  first_started_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint learning_progress_position_check check (last_position_seconds >= 0),
  constraint learning_progress_completion_check check (
    (completed = false and completed_at is null) or completed = true
  )
);
-- statement-breakpoint

create unique index if not exists learning_progress_enrollment_lesson_uq
  on public.learning_progress (enrollment_id, lesson_id);
-- statement-breakpoint

create index if not exists learning_progress_enrollment_idx
  on public.learning_progress (enrollment_id, updated_at desc, lesson_id);
