import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0017_learning_quiz_assessments.sql'

function migrationSql() {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  return readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()
}

test('learning quiz migration creates the normalized assessment graph additively', () => {
  const sql = migrationSql()

  for (const table of [
    'learning_quizzes',
    'learning_quiz_questions',
    'learning_quiz_options',
    'learning_quiz_attempts',
    'learning_quiz_attempt_answers',
  ]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}\\b`))
  }

  assert.match(sql, /lesson_id uuid not null unique references public\.learning_lessons\(id\) on delete cascade/)
  assert.match(sql, /quiz_id uuid not null references public\.learning_quizzes\(id\) on delete cascade/)
  assert.match(sql, /question_id uuid not null references public\.learning_quiz_questions\(id\) on delete cascade/)
  assert.match(sql, /enrollment_id uuid not null references public\.learning_enrollments\(id\) on delete cascade/)
  assert.match(sql, /learner_id uuid not null references public\.profiles\(id\) on delete cascade/)
  assert.match(sql, /attempt_id uuid not null references public\.learning_quiz_attempts\(id\) on delete cascade/)
  assert.match(sql, /selected_option_id uuid not null references public\.learning_quiz_options\(id\) on delete restrict/)

  assert.doesNotMatch(sql, /\bdrop\s+(table|type|column)\b/)
  assert.doesNotMatch(sql, /\btruncate\b/)
  assert.doesNotMatch(sql, /\bdelete\s+from\b/)
  assert.doesNotMatch(sql, /\bupdate\s+public\./)
})

test('learning quiz migration preserves server-authoritative single-answer scoring constraints', () => {
  const sql = migrationSql()

  assert.match(sql, /pass_percentage integer not null default 70/)
  assert.match(sql, /pass_percentage between 1 and 100/)
  assert.match(sql, /is_correct boolean not null default false/)
  assert.match(sql, /create unique index if not exists learning_quiz_options_single_correct_uq on public\.learning_quiz_options \(question_id\) where is_correct = true/)
  assert.match(sql, /create unique index if not exists learning_quiz_questions_quiz_position_uq/)
  assert.match(sql, /create unique index if not exists learning_quiz_options_question_position_uq/)
})

test('learning quiz migration snapshots immutable-attempt scoring facts and normalized answers', () => {
  const sql = migrationSql()

  for (const fragment of [
    'score integer not null',
    'total_questions integer not null',
    'percentage integer not null',
    'pass_percentage integer not null',
    'passed boolean not null',
    'submitted_at timestamptz not null default now()',
    'is_correct boolean not null',
  ]) assert.match(sql, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  assert.match(sql, /create unique index if not exists learning_quiz_attempt_answers_attempt_question_uq/)
  assert.match(sql, /create index if not exists learning_quiz_attempts_enrollment_idx/)
  assert.match(sql, /create index if not exists learning_quiz_attempts_learner_idx/)
})
