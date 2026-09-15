-- Sea N Shore native LMS Phase 2A: mentor-graded assignments with pass/fail and feedback.

alter table public.learning_assignments
  add column if not exists max_points integer not null default 100,
  add column if not exists passing_percentage integer not null default 70;
-- statement-breakpoint

alter table public.learning_assignments
  drop constraint if exists learning_assignments_max_points_check,
  drop constraint if exists learning_assignments_passing_percentage_check;
-- statement-breakpoint

alter table public.learning_assignments
  add constraint learning_assignments_max_points_check check (max_points between 1 and 100000),
  add constraint learning_assignments_passing_percentage_check check (passing_percentage between 1 and 100);
-- statement-breakpoint

alter table public.learning_assignment_attempts
  add column if not exists status text not null default 'submitted',
  add column if not exists score_points integer,
  add column if not exists percentage integer,
  add column if not exists passed boolean,
  add column if not exists feedback text,
  add column if not exists graded_by uuid references public.profiles(id) on delete set null,
  add column if not exists graded_at timestamptz;
-- statement-breakpoint

alter table public.learning_assignment_attempts
  drop constraint if exists learning_assignment_attempts_status_check,
  drop constraint if exists learning_assignment_attempts_score_check,
  drop constraint if exists learning_assignment_attempts_percentage_check,
  drop constraint if exists learning_assignment_attempts_feedback_check,
  drop constraint if exists learning_assignment_attempts_grading_shape_check;
-- statement-breakpoint

alter table public.learning_assignment_attempts
  add constraint learning_assignment_attempts_status_check check (status in ('submitted', 'graded')),
  add constraint learning_assignment_attempts_score_check check (score_points is null or score_points >= 0),
  add constraint learning_assignment_attempts_percentage_check check (percentage is null or percentage between 0 and 100),
  add constraint learning_assignment_attempts_feedback_check check (feedback is null or char_length(feedback) <= 10000),
  add constraint learning_assignment_attempts_grading_shape_check check (
    (status = 'submitted' and score_points is null and percentage is null and passed is null and graded_at is null)
    or (status = 'graded' and score_points is not null and percentage is not null and passed is not null and graded_at is not null)
  );
-- statement-breakpoint

update public.learning_assignment_attempts attempt
set status = 'graded',
    score_points = assignment.max_points,
    percentage = 100,
    passed = true,
    feedback = coalesce(attempt.feedback, 'Completed before mentor grading was introduced.'),
    graded_at = coalesce(attempt.graded_at, attempt.submitted_at)
from public.learning_assignments assignment,
     public.learning_progress progress
where assignment.id = attempt.assignment_id
  and progress.enrollment_id = attempt.enrollment_id
  and progress.lesson_id = attempt.lesson_id
  and progress.completed = true
  and attempt.status = 'submitted';
-- statement-breakpoint

create index if not exists learning_assignment_attempts_pending_review_idx
  on public.learning_assignment_attempts (assignment_id, submitted_at asc, id asc)
  where status = 'submitted';
-- statement-breakpoint

create index if not exists learning_assignment_attempts_lesson_history_idx
  on public.learning_assignment_attempts (enrollment_id, lesson_id, attempt_number desc);
