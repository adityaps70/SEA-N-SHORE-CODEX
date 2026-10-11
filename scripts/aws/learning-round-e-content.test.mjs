import assert from 'node:assert/strict'
import fs from 'node:fs'
import { guardAction } from './guard-value.mjs'

const script = fs.readFileSync('scripts/aws/learning-round-e-content.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/learning-round-e-content-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-learning-round-e-content.yml', 'utf8')
const task = fs.readFileSync('src/features/learning/round-e-content-task.ts', 'utf8')
const worker = fs.readFileSync('scripts/workers/learning-round-e-content.ts', 'utf8')
const builder = fs.readFileSync('scripts/build-workers.mjs', 'utf8')
const dockerfile = fs.readFileSync('Dockerfile', 'utf8')

assert.ok(['plan', 'apply-once'].includes(guard), 'the guard reads plan or apply-once')

// The runner starts the content worker from the deployed web image, overriding only its command and two variables.
assert.match(script, /310356785722/)
assert.match(script, /"\$\{LEARNING_ROUND_E_CONTENT_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
assert.match(script, /plan\|apply-once/)
assert.match(script, /aws ecs run-task/)
assert.match(script, /containerOverrides:\[\{name:"web",command:\["node",\$worker\],environment:\$environment\}\]/)
assert.match(script, /WORKER="dist\/workers\/learning-round-e-content\.mjs"/)
assert.match(script, /ROUND_E_CONTENT_MODE/)
assert.match(script, /CONFIRMATION="I_APPROVE_ROUND_E_SIRE_DRAFT_REVISION"/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
assert.match(script, /LEARNING_ROUND_E_CONTENT_PLAN_ONLY_NO_APPLY/)
assert.match(script, /LEARNING_ROUND_E_CONTENT_APPLY_VERIFIED=true/)
assert.doesNotMatch(script, /register-task-definition|update-service|delete-|rds-data/, 'the runner registers, changes and deletes nothing itself')
// The confirmation reaches the task only for apply-once.
const confirm = script.slice(script.indexOf('if [[ "$ACTION" == "apply-once" ]]; then\n  ENVIRONMENT'), script.indexOf('OVERRIDES='))
assert.ok(confirm.includes('ROUND_E_CONTENT_CONFIRM'), 'apply-once passes the confirmation')

// The worker is built into the image and only plans unless asked to apply with the phrase.
assert.match(builder, /'scripts\/workers\/learning-round-e-content\.ts'/)
assert.match(dockerfile, /test -f dist\/workers\/learning-round-e-content\.mjs/)
assert.match(worker, /process\.env\.ROUND_E_CONTENT_MODE \?\? 'plan'/)
assert.match(worker, /runRoundEContentApply\(deps, process\.env\.ROUND_E_CONTENT_CONFIRM\)/)
assert.match(task, /ROUND_E_APPLY_CONFIRMATION = 'I_APPROVE_ROUND_E_SIRE_DRAFT_REVISION'/)
assert.match(task, /startRevision\(course\.user_id, course\.id\)/, 'apply-once opens the draft through the Round A1 revision code')
// Writes are limited to the draft copy's plain-text articles, matched by their original text.
const writes = [...task.matchAll(/\b(insert into|update|delete from)\s+public\.(\w+)/gi)].map((match) => `${match[1].toLowerCase()} ${match[2]}`)
assert.deepEqual(writes, ['update learning_lessons'], 'the task updates draft lessons only')
assert.match(task, /lesson\.revision_source_id = \$2/)
assert.match(task, /and lesson\.article_format = 'plain'\s+and lesson\.article_body = \$4/)
assert.match(task, /section\.course_id = \$1/)
assert.doesNotMatch(task, /status = 'submitted'|status = 'published'|submitted_at/, 'nothing is submitted or published')
// No learner data: only counts of enrolments; no names, emails or answers.
assert.doesNotMatch(task, /\bemail\b|display_name|full_name|public\.profiles|learning_quiz_attempts|learning_progress\b/i)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard the content task against a moved branch/)
assert.match(workflow, /Require a deployed image that has the content worker/)
assert.match(workflow, /git cat-file -e "\$IMAGE_SHA:scripts\/workers\/learning-round-e-content\.ts"/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /LEARNING_ROUND_E_CONTENT_EXPECTED_SHA/)
assert.match(workflow, /LEARNING_ROUND_E_CONTENT_ACTION/)
assert.match(workflow, /I_APPROVE_ROUND_E_SIRE_DRAFT_REVISION/)
assert.match(workflow, /bash scripts\/aws\/learning-round-e-content\.sh/)
assert.doesNotMatch(workflow, /list.items|LIST_ITEMS|0071/i)

console.log('LEARNING_ROUND_E_CONTENT_CONTRACT_VERIFIED=true')
