-- Sea N Shore Learning assessments: normalized, server-authoritative quiz definitions and learner attempts.

create table if not exists public.learning_quizzes (
  id uuid primary key default gen_random_uuid(),
  lesson_id uuid not null unique references public.learning_lessons(id) on delete cascade,
  pass_percentage integer not null default 70,
  instructions text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_quizzes_pass_percentage_check check (pass_percentage between 1 and 100),
  constraint learning_quizzes_instructions_check check (
    instructions is null or char_length(instructions) <= 4000
  )
);
-- statement-breakpoint

create table if not exists public.learning_quiz_questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  prompt text not null,
  position integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_quiz_questions_prompt_check check (
    prompt = btrim(prompt) and char_length(prompt) between 1 and 4000
  ),
  constraint learning_quiz_questions_position_check check (position >= 0)
);
-- statement-breakpoint

create unique index if not exists learning_quiz_questions_quiz_position_uq
  on public.learning_quiz_questions (quiz_id, position);
-- statement-breakpoint

create table if not exists public.learning_quiz_options (
  id uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.learning_quiz_questions(id) on delete cascade,
  label text not null,
  position integer not null,
  is_correct boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_quiz_options_label_check check (
    label = btrim(label) and char_length(label) between 1 and 2000
  ),
  constraint learning_quiz_options_position_check check (position >= 0)
);
-- statement-breakpoint

create unique index if not exists learning_quiz_options_question_position_uq
  on public.learning_quiz_options (question_id, position);
-- statement-breakpoint

create unique index if not exists learning_quiz_options_single_correct_uq
  on public.learning_quiz_options (question_id)
  where is_correct = true;
-- statement-breakpoint

create table if not exists public.learning_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  score integer not null,
  total_questions integer not null,
  percentage integer not null,
  pass_percentage integer not null,
  passed boolean not null,
  submitted_at timestamptz not null default now(),
  constraint learning_quiz_attempts_score_check check (
    total_questions > 0 and score between 0 and total_questions
  ),
  constraint learning_quiz_attempts_percentage_check check (percentage between 0 and 100),
  constraint learning_quiz_attempts_pass_percentage_check check (pass_percentage between 1 and 100)
);
-- statement-breakpoint

create index if not exists learning_quiz_attempts_enrollment_idx
  on public.learning_quiz_attempts (enrollment_id, quiz_id, submitted_at desc, id desc);
-- statement-breakpoint

create index if not exists learning_quiz_attempts_learner_idx
  on public.learning_quiz_attempts (learner_id, submitted_at desc, id desc);
-- statement-breakpoint

create table if not exists public.learning_quiz_attempt_answers (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.learning_quiz_attempts(id) on delete cascade,
  question_id uuid not null references public.learning_quiz_questions(id) on delete restrict,
  selected_option_id uuid not null references public.learning_quiz_options(id) on delete restrict,
  is_correct boolean not null,
  created_at timestamptz not null default now()
);
-- statement-breakpoint

create unique index if not exists learning_quiz_attempt_answers_attempt_question_uq
  on public.learning_quiz_attempt_answers (attempt_id, question_id);
