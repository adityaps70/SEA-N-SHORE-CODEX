-- Sea N Shore learning round B: question banks, question types and marking, quiz settings (timer, shuffle,
-- random draw, answer policy), timed attempt sessions, and the certificate builder.
--
-- Additive and safe to run more than once. It relaxes exactly three existing rules, as approved for round B:
--   1. learning_quiz_questions.quiz_id may be null, so a question can live in a bank without a quiz;
--   2. the unique index learning_quiz_options_single_correct_uq becomes a type-aware check, so a
--      multiple-correct question can mark several options correct (single-answer types still allow one);
--   3. an answer may have no selected option (multiple-correct, fill-in-the-blank and subjective answers),
--      so selected_option_id and correct_option_id may be null.
-- Existing quizzes, attempts, answers and certificates keep their values: every new column has a default that
-- matches how they already behave. The backfill copies each trainer's existing quiz questions into a bank and
-- links each quiz question to its bank copy; it changes no prompt, option, attempt or answer.

create table if not exists public.learning_question_banks (
  id uuid primary key default gen_random_uuid(),
  mentor_id uuid references public.learning_mentors(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint learning_question_banks_owner_check check (num_nonnulls(mentor_id, company_id) = 1)
);
-- statement-breakpoint

create unique index if not exists learning_question_banks_mentor_uq
  on public.learning_question_banks (mentor_id)
  where mentor_id is not null;
-- statement-breakpoint

create unique index if not exists learning_question_banks_company_uq
  on public.learning_question_banks (company_id)
  where company_id is not null;
-- statement-breakpoint

-- Relaxation 1: a bank question has no quiz.
alter table public.learning_quiz_questions
  alter column quiz_id drop not null;
-- statement-breakpoint

alter table public.learning_quiz_questions
  add column if not exists bank_id uuid references public.learning_question_banks(id) on delete cascade,
  add column if not exists question_type text not null default 'single_choice'
    constraint learning_quiz_questions_type_check check (
      question_type in ('single_choice', 'multiple_choice', 'true_false', 'fill_blank', 'subjective')
    ),
  add column if not exists marks numeric(6, 2) not null default 1
    constraint learning_quiz_questions_marks_check check (marks > 0 and marks <= 100),
  add column if not exists negative_marks numeric(6, 2) not null default 0
    constraint learning_quiz_questions_negative_marks_check check (negative_marks >= 0 and negative_marks <= 100),
  add column if not exists explanation text
    constraint learning_quiz_questions_explanation_check check (
      explanation is null or char_length(explanation) between 1 and 4000
    ),
  add column if not exists accepted_answers text[] not null default '{}'
    constraint learning_quiz_questions_accepted_answers_check check (cardinality(accepted_answers) <= 20),
  add column if not exists answers_case_sensitive boolean not null default false,
  add column if not exists topic text
    constraint learning_quiz_questions_topic_check check (
      topic is null or (topic = btrim(topic) and char_length(topic) between 1 and 80)
    ),
  add column if not exists difficulty text
    constraint learning_quiz_questions_difficulty_check check (
      difficulty is null or difficulty in ('easy', 'medium', 'hard')
    ),
  add column if not exists department_key text
    constraint learning_quiz_questions_department_key_check check (
      department_key is null or department_key ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  add column if not exists role_key text
    constraint learning_quiz_questions_role_key_check check (
      role_key is null or role_key ~ '^[a-z][a-z0-9_]{0,63}$'
    ),
  add column if not exists source_question_id uuid references public.learning_quiz_questions(id) on delete set null,
  add column if not exists imported_from_question_id uuid references public.learning_quiz_questions(id) on delete set null;
-- statement-breakpoint

-- Every question belongs to a quiz, a bank, or both (a quiz copy keeps quiz_id; a bank question keeps bank_id).
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'learning_quiz_questions_owner_check'
      and conrelid = 'public.learning_quiz_questions'::regclass
  ) then
    alter table public.learning_quiz_questions
      add constraint learning_quiz_questions_owner_check check (quiz_id is not null or bank_id is not null);
  end if;
end;
$$;
-- statement-breakpoint

create index if not exists learning_quiz_questions_bank_idx
  on public.learning_quiz_questions (bank_id, created_at desc, id desc)
  where bank_id is not null and removed_at is null;
-- statement-breakpoint

create unique index if not exists learning_quiz_questions_imported_from_uq
  on public.learning_quiz_questions (imported_from_question_id)
  where imported_from_question_id is not null;
-- statement-breakpoint

create index if not exists learning_quiz_questions_source_idx
  on public.learning_quiz_questions (source_question_id)
  where source_question_id is not null;
-- statement-breakpoint

-- Relaxation 2: one correct option is now checked per question type (single-answer types only), in place of the
-- unique index. The check runs at the end of the transaction, so an editor may clear and reset answers, or change
-- a question's type, in any order.
create or replace function public.learning_quiz_single_correct_check()
returns trigger
language plpgsql
as $$
declare
  target uuid;
begin
  if tg_table_name = 'learning_quiz_options' then
    target := new.question_id;
  else
    target := new.id;
  end if;

  if exists (
    select 1
    from public.learning_quiz_questions question
    where question.id = target
      and question.question_type in ('single_choice', 'true_false')
      and (
        select count(*)
        from public.learning_quiz_options option
        where option.question_id = question.id
          and option.is_correct = true
      ) > 1
  ) then
    raise exception 'quiz question % allows only one correct option', target using errcode = '23505';
  end if;

  return null;
end;
$$;
-- statement-breakpoint

do $$
begin
  if not exists (
    select 1 from pg_trigger
    where tgname = 'learning_quiz_options_single_correct_check'
      and tgrelid = 'public.learning_quiz_options'::regclass
  ) then
    create constraint trigger learning_quiz_options_single_correct_check
      after insert or update of is_correct, question_id on public.learning_quiz_options
      deferrable initially deferred
      for each row
      execute function public.learning_quiz_single_correct_check();
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgname = 'learning_quiz_questions_single_correct_check'
      and tgrelid = 'public.learning_quiz_questions'::regclass
  ) then
    create constraint trigger learning_quiz_questions_single_correct_check
      after update of question_type on public.learning_quiz_questions
      deferrable initially deferred
      for each row
      execute function public.learning_quiz_single_correct_check();
  end if;
end;
$$;
-- statement-breakpoint

drop index if exists public.learning_quiz_options_single_correct_uq;
-- statement-breakpoint

alter table public.learning_quizzes
  add column if not exists time_limit_minutes integer
    constraint learning_quizzes_time_limit_check check (time_limit_minutes is null or time_limit_minutes between 1 and 600),
  add column if not exists shuffle_questions boolean not null default false,
  add column if not exists shuffle_options boolean not null default false,
  add column if not exists draw_count integer
    constraint learning_quizzes_draw_count_check check (draw_count is null or draw_count between 1 and 200),
  add column if not exists answer_policy text not null default 'after_each_attempt'
    constraint learning_quizzes_answer_policy_check check (
      answer_policy in ('never', 'after_each_attempt', 'after_pass', 'after_last_attempt')
    );
-- statement-breakpoint

-- A started attempt: the drawn questions and option order are fixed here, answers are saved as the learner goes,
-- and the server deadline (if the quiz is timed) is the only clock that counts.
create table if not exists public.learning_quiz_attempt_sessions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.learning_quizzes(id) on delete cascade,
  enrollment_id uuid not null references public.learning_enrollments(id) on delete cascade,
  learner_id uuid not null references public.profiles(id) on delete cascade,
  question_ids uuid[] not null,
  option_order jsonb not null default '{}'::jsonb,
  draft_answers jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  deadline_at timestamptz,
  closed_at timestamptz,
  attempt_id uuid references public.learning_quiz_attempts(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint learning_quiz_attempt_sessions_questions_check check (cardinality(question_ids) between 1 and 200),
  constraint learning_quiz_attempt_sessions_deadline_check check (deadline_at is null or deadline_at > started_at)
);
-- statement-breakpoint

create unique index if not exists learning_quiz_attempt_sessions_open_uq
  on public.learning_quiz_attempt_sessions (enrollment_id, quiz_id)
  where closed_at is null;
-- statement-breakpoint

create index if not exists learning_quiz_attempt_sessions_deadline_idx
  on public.learning_quiz_attempt_sessions (deadline_at asc, id asc)
  where closed_at is null and deadline_at is not null;
-- statement-breakpoint

alter table public.learning_quiz_attempts
  add column if not exists session_id uuid references public.learning_quiz_attempt_sessions(id) on delete set null,
  add column if not exists started_at timestamptz,
  add column if not exists score_points numeric(8, 2),
  add column if not exists max_points numeric(8, 2),
  add column if not exists status text not null default 'completed'
    constraint learning_quiz_attempts_status_check check (status in ('completed', 'awaiting_grading')),
  add column if not exists graded_at timestamptz,
  add column if not exists auto_submitted boolean not null default false;
-- statement-breakpoint

create unique index if not exists learning_quiz_attempts_session_uq
  on public.learning_quiz_attempts (session_id)
  where session_id is not null;
-- statement-breakpoint

create index if not exists learning_quiz_attempts_awaiting_idx
  on public.learning_quiz_attempts (quiz_id, submitted_at asc, id asc)
  where status = 'awaiting_grading';
-- statement-breakpoint

-- Relaxation 3: an answer may have no single selected option.
alter table public.learning_quiz_attempt_answers
  alter column selected_option_id drop not null,
  alter column correct_option_id drop not null;
-- statement-breakpoint

alter table public.learning_quiz_attempt_answers
  add column if not exists selected_option_ids uuid[],
  add column if not exists correct_option_ids uuid[],
  add column if not exists text_response text
    constraint learning_quiz_attempt_answers_text_check check (
      text_response is null or char_length(text_response) <= 10000
    ),
  add column if not exists points_awarded numeric(8, 2),
  add column if not exists max_points numeric(8, 2),
  add column if not exists grading_status text not null default 'auto'
    constraint learning_quiz_attempt_answers_grading_status_check check (grading_status in ('auto', 'pending', 'graded')),
  add column if not exists feedback text
    constraint learning_quiz_attempt_answers_feedback_check check (
      feedback is null or char_length(feedback) between 1 and 4000
    ),
  add column if not exists graded_by uuid references public.profiles(id) on delete set null,
  add column if not exists graded_at timestamptz;
-- statement-breakpoint

create index if not exists learning_quiz_attempt_answers_pending_idx
  on public.learning_quiz_attempt_answers (attempt_id)
  where grading_status = 'pending';
-- statement-breakpoint

-- The 0021 snapshot still fills in the correct option of a single-option answer; an answer with no selected
-- option (multiple-correct, fill-in-the-blank, subjective) records its own key instead.
create or replace function public.learning_quiz_answer_snapshot_compat()
returns trigger
language plpgsql
as $$
begin
  if new.selected_option_id is null then
    return new;
  end if;

  if new.correct_option_id is null then
    select option.id
      into new.correct_option_id
    from public.learning_quiz_options option
    where option.question_id = new.question_id
      and option.is_correct = true;
  end if;

  if new.correct_option_id is null then
    raise exception 'quiz question % has no correct option configured', new.question_id;
  end if;

  return new;
end;
$$;
-- statement-breakpoint

-- B4: the final quiz that can issue a course's certificate.
alter table public.learning_lessons
  add column if not exists certificate_final boolean not null default false;
-- statement-breakpoint

alter table public.learning_courses
  add column if not exists certificate_template text not null default 'classic'
    constraint learning_courses_certificate_template_check check (
      certificate_template in ('classic', 'modern', 'formal', 'minimal')
    ),
  add column if not exists certificate_logo_path text
    constraint learning_courses_certificate_logo_path_check check (
      certificate_logo_path is null or char_length(certificate_logo_path) between 1 and 500
    ),
  add column if not exists certificate_signature_path text
    constraint learning_courses_certificate_signature_path_check check (
      certificate_signature_path is null or char_length(certificate_signature_path) between 1 and 500
    ),
  add column if not exists certificate_signatory_name text
    constraint learning_courses_certificate_signatory_name_check check (
      certificate_signatory_name is null
      or (certificate_signatory_name = btrim(certificate_signatory_name) and char_length(certificate_signatory_name) between 2 and 120)
    ),
  add column if not exists certificate_signatory_title text
    constraint learning_courses_certificate_signatory_title_check check (
      certificate_signatory_title is null
      or (certificate_signatory_title = btrim(certificate_signatory_title) and char_length(certificate_signatory_title) between 2 and 120)
    ),
  add column if not exists certificate_serial_prefix text
    constraint learning_courses_certificate_serial_prefix_check check (
      certificate_serial_prefix is null or certificate_serial_prefix ~ '^[A-Z0-9]{1,10}(-[A-Z0-9]{1,10}){0,3}-$'
    ),
  add column if not exists certificate_validity_months integer
    constraint learning_courses_certificate_validity_check check (
      certificate_validity_months is null or certificate_validity_months between 1 and 120
    ),
  add column if not exists certificate_issue_trigger text not null default 'course_completion'
    constraint learning_courses_certificate_issue_trigger_check check (
      certificate_issue_trigger in ('course_completion', 'final_quiz')
    );
-- statement-breakpoint

-- Existing certificates keep their design (template_key null = the original layout), number and link, and never
-- expire (expires_at null).
alter table public.learning_certificates
  add column if not exists template_key text
    constraint learning_certificates_template_key_check check (
      template_key is null or template_key in ('classic', 'modern', 'formal', 'minimal')
    ),
  add column if not exists serial_number text
    constraint learning_certificates_serial_number_check check (
      serial_number is null or serial_number ~ '^[A-Z0-9]{1,10}(-[A-Z0-9]{1,10}){0,3}-[0-9]{4}-[A-F0-9]{8}$'
    ),
  add column if not exists expires_at timestamptz,
  add column if not exists logo_path text,
  add column if not exists signature_path text,
  add column if not exists signatory_name text,
  add column if not exists signatory_title text,
  add column if not exists issued_for text
    constraint learning_certificates_issued_for_check check (
      issued_for is null or issued_for in ('course_completion', 'final_quiz')
    ),
  add column if not exists hidden_from_profile boolean not null default false;
-- statement-breakpoint

create unique index if not exists learning_certificates_serial_number_uq
  on public.learning_certificates (serial_number)
  where serial_number is not null;
-- statement-breakpoint

create index if not exists learning_certificates_expiry_idx
  on public.learning_certificates (expires_at asc, id asc)
  where expires_at is not null;
-- statement-breakpoint

-- Learning emails gain the graded-quiz and certificate-renewal reminders (a further widening of the round A list).
alter table public.learning_notification_emails
  drop constraint if exists learning_notification_emails_kind_check,
  add constraint learning_notification_emails_kind_check check (
    kind in (
      'enrolled',
      'lessons_released',
      'assignment_graded',
      'certificate_issued',
      'course_approved',
      'course_changes_requested',
      'submissions_to_grade',
      'quiz_graded',
      'certificate_expiring'
    )
  );
-- statement-breakpoint

-- Backfill 1: every trainer with a live course gets a bank.
insert into public.learning_question_banks (mentor_id)
select distinct course.mentor_id
from public.learning_courses course
where course.revision_of_course_id is null
on conflict (mentor_id) where mentor_id is not null do nothing;
-- statement-breakpoint

-- Backfill 2: each live quiz question of a live course is copied into its trainer's bank (once).
insert into public.learning_quiz_questions (
  bank_id, prompt, position, question_type, imported_from_question_id, created_at, updated_at
)
select bank.id, question.prompt, 0, question.question_type, question.id, question.created_at, now()
from public.learning_quiz_questions question
inner join public.learning_quizzes quiz on quiz.id = question.quiz_id
inner join public.learning_lessons lesson on lesson.id = quiz.lesson_id
inner join public.learning_course_sections section on section.id = lesson.section_id
inner join public.learning_courses course on course.id = section.course_id
inner join public.learning_question_banks bank on bank.mentor_id = course.mentor_id
where course.revision_of_course_id is null
  and question.removed_at is null
  and question.bank_id is null
  and not exists (
    select 1 from public.learning_quiz_questions copy where copy.imported_from_question_id = question.id
  );
-- statement-breakpoint

-- Backfill 3: the bank copies get the same answer options.
insert into public.learning_quiz_options (question_id, label, position, is_correct, created_at, updated_at)
select copy.id, option.label, option.position, option.is_correct, option.created_at, now()
from public.learning_quiz_questions copy
inner join public.learning_quiz_options option on option.question_id = copy.imported_from_question_id
where copy.bank_id is not null
  and copy.imported_from_question_id is not null
  and option.removed_at is null
on conflict (question_id, position) do nothing;
-- statement-breakpoint

-- Backfill 4: each live quiz question is linked to its bank copy; prompts, options and answers are untouched.
update public.learning_quiz_questions question
set source_question_id = copy.id
from public.learning_quiz_questions copy
where copy.imported_from_question_id = question.id
  and question.source_question_id is null;
-- statement-breakpoint

-- Backfill 5: open draft revisions link to the same bank copy as the live question they were copied from.
update public.learning_quiz_questions question
set source_question_id = live.source_question_id
from public.learning_quiz_questions live
where question.revision_source_id = live.id
  and question.source_question_id is null
  and live.source_question_id is not null;
