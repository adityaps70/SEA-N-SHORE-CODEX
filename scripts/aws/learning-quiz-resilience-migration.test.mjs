import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('infra/aws/database/migrations/0021_learning_quiz_attempt_resilience.sql', 'utf8')
const script = fs.readFileSync('scripts/aws/learning-quiz-resilience-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/learning-quiz-resilience-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-learning-quiz-resilience-migration.yml', 'utf8')

assert.ok(['plan', 'migrate-once'].includes(guard))
assert.match(sql, /attempt_number integer/i)
assert.match(sql, /submission_key uuid/i)
assert.match(sql, /row_number\(\) over/i)
assert.match(sql, /learning_quiz_attempts_enrollment_quiz_number_uq/)
assert.match(sql, /learning_quiz_attempts_submission_key_uq/)
assert.match(sql, /correct_option_id uuid/i)
assert.match(sql, /learning_quiz_options/i)
assert.doesNotMatch(sql, /drop table/i)
assert.doesNotMatch(sql, /drop column/i)
assert.doesNotMatch(sql, /delete from/i)
assert.doesNotMatch(sql, /truncate/i)

assert.match(script, /310356785722/)
assert.match(script, /migrate-once/)
assert.match(script, /LEARNING_QUIZ_RESILIENCE_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /LEARNING_QUIZ_RESILIENCE_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
assert.match(script, /sea-n-shore-learning-quiz-resilience-0021/)
assert.doesNotMatch(script, /992382634586/)

assert.match(workflow, /AWS Infrastructure CI/)
assert.match(workflow, /310356785722/)
assert.match(workflow, /migrate-once/)
assert.match(workflow, /github\.sha/)
assert.match(workflow, /runuser -u ssm-user/)
assert.match(workflow, /get-command-invocation/)
assert.doesNotMatch(workflow, /992382634586/)

console.log('LEARNING_QUIZ_RESILIENCE_MIGRATION_CONTRACT_VERIFIED=true')
