import assert from 'node:assert/strict'
import fs from 'node:fs'

const sql = fs.readFileSync('infra/aws/database/migrations/0022_learning_course_discoverability.sql', 'utf8')
const script = fs.readFileSync('scripts/aws/learning-course-discoverability-migration.sh', 'utf8')
const guard = fs.readFileSync('scripts/aws/learning-course-discoverability-migration-action.txt', 'utf8').trim()
const workflow = fs.readFileSync('.github/workflows/aws-learning-course-discoverability-migration.yml', 'utf8')

assert.ok(['plan', 'migrate-once'].includes(guard))
assert.match(sql, /is_discoverable boolean not null default false/i)
assert.match(sql, /update public\.learning_courses[\s\S]*set is_discoverable = true[\s\S]*where status = 'published'/i)
assert.match(sql, /learning_courses_discoverable_published_idx/)
assert.doesNotMatch(sql, /drop table/i)
assert.doesNotMatch(sql, /drop column/i)
assert.doesNotMatch(sql, /delete from/i)
assert.doesNotMatch(sql, /truncate/i)

assert.match(script, /310356785722/)
assert.match(script, /migrate-once/)
assert.match(script, /expected exactly three additive discoverability statements/)
assert.match(script, /update\\s\+public\\\.learning_courses/)
assert.match(script, /column_default IN \('false','false::boolean'\)/)
assert.match(script, /LEARNING_COURSE_DISCOVERABILITY_MIGRATION_APPLY_VERIFIED=true/)
assert.match(script, /LEARNING_COURSE_DISCOVERABILITY_MIGRATION_ALREADY_APPLIED=true/)
assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
assert.match(script, /sea-n-shore-learning-course-discoverability-0022/)
assert.doesNotMatch(script, /992382634586/)

assert.match(workflow, /AWS Infrastructure CI/)
assert.match(workflow, /310356785722/)
assert.match(workflow, /migrate-once/)
assert.match(workflow, /github\.sha/)
assert.match(workflow, /runuser -u ssm-user/)
assert.match(workflow, /get-command-invocation/)
assert.doesNotMatch(workflow, /992382634586/)

console.log('LEARNING_COURSE_DISCOVERABILITY_MIGRATION_CONTRACT_VERIFIED=true')
