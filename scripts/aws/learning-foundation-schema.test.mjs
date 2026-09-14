import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0016_learning_foundation.sql'
const quizMigrationPath = 'infra/aws/database/migrations/0017_learning_quiz_assessments.sql'

const expectedTables = [
  'learning_mentor_applications',
  'learning_mentors',
  'learning_courses',
  'learning_course_sections',
  'learning_lessons',
  'learning_enrollments',
  'learning_progress',
]

test('learning foundation migration is additive and limited to Phase 1 foundations', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const sql = readFileSync(migrationPath, 'utf8')
  const normalized = sql.replace(/\s+/g, ' ').toLowerCase()

  for (const table of expectedTables) {
    assert.match(normalized, new RegExp(`create table if not exists public\\.${table}\\b`))
  }

  for (const deferredTable of [
    'learning_orders',
    'learning_payments',
    'learning_reviews',
    'learning_quizzes',
    'learning_questions',
    'learning_certificates',
    'learning_mentor_earnings',
    'learning_payouts',
    'learning_coupons',
  ]) {
    assert.doesNotMatch(normalized, new RegExp(`create table if not exists public\\.${deferredTable}\\b`))
  }

  assert.doesNotMatch(normalized, /\bdrop\s+(table|type|column)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(normalized, /\bdelete\s+from\b/)
  assert.doesNotMatch(normalized, /\bupdate\s+public\./)
})

test('learning foundation preserves Cognito-backed profile identity and review workflows', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const normalized = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /user_id uuid not null references public\.profiles\(id\)/)
  assert.match(normalized, /reviewed_by uuid references public\.profiles\(id\)/)
  assert.match(normalized, /approved_by uuid not null references public\.profiles\(id\)/)
  assert.match(normalized, /pending.*changes_requested.*approved.*rejected/)
  assert.match(normalized, /draft.*submitted.*changes_requested.*approved.*published.*archived/)
  assert.match(normalized, /active.*suspended/)
  assert.match(normalized, /recorded.*live_cohort.*hybrid/)
  assert.match(normalized, /free.*paid/)
})

test('learning foundation models maritime course authoring and safe enrollment progress', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const normalized = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /video.*article.*pdf.*presentation_document.*audio.*quiz.*assignment.*downloadable_resource.*live_session/)
  assert.match(normalized, /price_minor bigint/)
  assert.match(normalized, /discount_price_minor bigint/)
  assert.match(normalized, /currency varchar\(3\)/)
  assert.match(normalized, /certificate_enabled boolean/)
  assert.match(normalized, /free.*purchase.*admin/)
  assert.match(normalized, /active.*completed.*revoked/)
  assert.match(normalized, /last_position_seconds integer/)
  assert.match(normalized, /create unique index if not exists learning_sections_course_position_uq/)
  assert.match(normalized, /create unique index if not exists learning_lessons_section_position_uq/)
  assert.match(normalized, /create unique index if not exists learning_enrollments_course_learner_uq/)
  assert.match(normalized, /create unique index if not exists learning_progress_enrollment_lesson_uq/)
  assert.match(normalized, /create index if not exists learning_courses_marketplace_idx/)
  assert.match(normalized, /create index if not exists learning_mentor_applications_admin_queue_idx/)
})

test('course pricing never permits a negative base price when a discount is present', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} should exist`)
  const normalized = readFileSync(migrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(
    normalized,
    /constraint learning_courses_price_check check \( price_minor >= 0 and \(discount_price_minor is null or discount_price_minor >= 0\) \)/,
  )
})

test('learning quiz extension creates the normalized assessment graph additively', () => {
  assert.equal(existsSync(quizMigrationPath), true, `${quizMigrationPath} should exist`)
  const normalized = readFileSync(quizMigrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  for (const table of [
    'learning_quizzes',
    'learning_quiz_questions',
    'learning_quiz_options',
    'learning_quiz_attempts',
    'learning_quiz_attempt_answers',
  ]) {
    assert.match(normalized, new RegExp(`create table if not exists public\\.${table}\\b`))
  }

  assert.match(normalized, /lesson_id uuid not null unique references public\.learning_lessons\(id\) on delete cascade/)
  assert.match(normalized, /quiz_id uuid not null references public\.learning_quizzes\(id\) on delete cascade/)
  assert.match(normalized, /question_id uuid not null references public\.learning_quiz_questions\(id\) on delete cascade/)
  assert.match(normalized, /enrollment_id uuid not null references public\.learning_enrollments\(id\) on delete cascade/)
  assert.match(normalized, /learner_id uuid not null references public\.profiles\(id\) on delete cascade/)
  assert.match(normalized, /attempt_id uuid not null references public\.learning_quiz_attempts\(id\) on delete cascade/)
  assert.match(normalized, /selected_option_id uuid not null references public\.learning_quiz_options\(id\) on delete restrict/)

  assert.doesNotMatch(normalized, /\bdrop\s+(table|type|column)\b/)
  assert.doesNotMatch(normalized, /\btruncate\b/)
  assert.doesNotMatch(normalized, /\bdelete\s+from\b/)
  assert.doesNotMatch(normalized, /\bupdate\s+public\./)
})

test('learning quiz extension preserves server-authoritative single-answer scoring and attempt snapshots', () => {
  assert.equal(existsSync(quizMigrationPath), true, `${quizMigrationPath} should exist`)
  const normalized = readFileSync(quizMigrationPath, 'utf8').replace(/\s+/g, ' ').toLowerCase()

  assert.match(normalized, /pass_percentage integer not null default 70/)
  assert.match(normalized, /pass_percentage between 1 and 100/)
  assert.match(normalized, /is_correct boolean not null default false/)
  assert.match(normalized, /create unique index if not exists learning_quiz_options_single_correct_uq on public\.learning_quiz_options \(question_id\) where is_correct = true/)
  assert.match(normalized, /create unique index if not exists learning_quiz_questions_quiz_position_uq/)
  assert.match(normalized, /create unique index if not exists learning_quiz_options_question_position_uq/)
  assert.match(normalized, /score integer not null/)
  assert.match(normalized, /total_questions integer not null/)
  assert.match(normalized, /percentage integer not null/)
  assert.match(normalized, /passed boolean not null/)
  assert.match(normalized, /submitted_at timestamptz not null default now\(\)/)
  assert.match(normalized, /create unique index if not exists learning_quiz_attempt_answers_attempt_question_uq/)
  assert.match(normalized, /create index if not exists learning_quiz_attempts_enrollment_idx/)
  assert.match(normalized, /create index if not exists learning_quiz_attempts_learner_idx/)
})
