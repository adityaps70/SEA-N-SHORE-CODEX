-- Sea N Shore Learning quiz attempt resilience: durable numbering, idempotency and immutable answer snapshots.
-- Compatibility triggers keep the previously deployed quiz writer valid during the migration-to-deploy gap.

alter table public.learning_quiz_attempts
  add column if not exists attempt_number integer;
-- statement-breakpoint

alter table public.learning_quiz_attempts
  add column if not exists submission_key uuid;
-- statement-breakpoint

update public.learning_quiz_attempts attempt
set attempt_number = ranked.attempt_number
from (
  select
    id,
    row_number() over (
      partition by enrollment_id, quiz_id
      order by submitted_at asc, id asc
    )::integer as attempt_number
  from public.learning_quiz_attempts
) ranked
where ranked.id = attempt.id
  and attempt.attempt_number is null;
-- statement-breakpoint

create or replace function public.learning_quiz_attempt_number_compat()
returns trigger
language plpgsql
as $$
begin
  if new.attempt_number is null then
    perform pg_advisory_xact_lock(
      hashtext(new.enrollment_id::text || ':' || new.quiz_id::text)::bigint
    );

    select coalesce(max(attempt_number), 0) + 1
      into new.attempt_number
    from public.learning_quiz_attempts
    where enrollment_id = new.enrollment_id
      and quiz_id = new.quiz_id;
  end if;

  return new;
end;
$$;
-- statement-breakpoint

create or replace trigger learning_quiz_attempt_number_compat
before insert on public.learning_quiz_attempts
for each row
execute function public.learning_quiz_attempt_number_compat();
-- statement-breakpoint

alter table public.learning_quiz_attempts
  alter column attempt_number set not null;
-- statement-breakpoint

alter table public.learning_quiz_attempts
  add constraint learning_quiz_attempts_attempt_number_check
  check (attempt_number > 0);
-- statement-breakpoint

create unique index if not exists learning_quiz_attempts_enrollment_quiz_number_uq
  on public.learning_quiz_attempts (enrollment_id, quiz_id, attempt_number);
-- statement-breakpoint

create unique index if not exists learning_quiz_attempts_submission_key_uq
  on public.learning_quiz_attempts (enrollment_id, quiz_id, submission_key)
  where submission_key is not null;
-- statement-breakpoint

alter table public.learning_quiz_attempt_answers
  add column if not exists correct_option_id uuid
  references public.learning_quiz_options(id) on delete restrict;
-- statement-breakpoint

update public.learning_quiz_attempt_answers answer
set correct_option_id = case
  when answer.is_correct then answer.selected_option_id
  else correct.id
end
from public.learning_quiz_options correct
where correct.question_id = answer.question_id
  and correct.is_correct = true
  and answer.correct_option_id is null;
-- statement-breakpoint

create or replace function public.learning_quiz_answer_snapshot_compat()
returns trigger
language plpgsql
as $$
begin
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

create or replace trigger learning_quiz_answer_snapshot_compat
before insert on public.learning_quiz_attempt_answers
for each row
execute function public.learning_quiz_answer_snapshot_compat();
-- statement-breakpoint

alter table public.learning_quiz_attempt_answers
  alter column correct_option_id set not null;
