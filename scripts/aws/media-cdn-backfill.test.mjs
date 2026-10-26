import assert from 'node:assert/strict'
import fs from 'node:fs'
import { guardAction } from './guard-value.mjs'

const script = fs.readFileSync('scripts/aws/media-cdn-backfill.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/media-cdn-backfill-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-media-cdn-backfill.yml', 'utf8')
const task = fs.readFileSync('src/features/media/media-cdn-backfill-task.ts', 'utf8')
const worker = fs.readFileSync('scripts/workers/media-cdn-backfill.ts', 'utf8')
const builder = fs.readFileSync('scripts/build-workers.mjs', 'utf8')
const dockerfile = fs.readFileSync('Dockerfile', 'utf8')

assert.ok(['plan', 'apply-once'].includes(guard), 'the guard reads plan or apply-once')

// The runner starts the backfill worker from the deployed web image, overriding only its command and one variable.
assert.match(script, /310356785722/)
assert.match(script, /"\$\{MEDIA_CDN_BACKFILL_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
assert.match(script, /plan\|apply-once/)
assert.match(script, /aws ecs run-task/)
assert.match(script, /containerOverrides:\[\{name:"web",command:\["node",\$worker\],environment:\$environment\}\]/)
assert.match(script, /WORKER="dist\/workers\/media-cdn-backfill\.mjs"/)
assert.match(script, /MEDIA_CDN_BACKFILL_MODE/)
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
assert.match(script, /MEDIA_CDN_BACKFILL_PLAN_ONLY_NO_APPLY/)
assert.match(script, /MEDIA_CDN_BACKFILL_APPLY_VERIFIED=true/)
assert.match(script, /MEDIA_CDN_BACKFILL_COMPLETE=true/)
assert.doesNotMatch(script, /register-task-definition|update-service|delete-|rds-data|s3 rm|s3api delete/, 'the runner registers, changes and deletes nothing itself')

// The worker is built into the image and only plans unless asked to apply.
assert.match(builder, /'scripts\/workers\/media-cdn-backfill\.ts'/)
assert.match(dockerfile, /test -f dist\/workers\/media-cdn-backfill\.mjs/)
assert.match(worker, /process\.env\.MEDIA_CDN_BACKFILL_MODE \?\? 'plan'/)
// The task reads the database only: no row is written, and nothing in the bucket is ever deleted.
assert.doesNotMatch(task, /\b(insert into|update\s+public\.|delete from)\b/i, 'the task never writes the database')
assert.doesNotMatch(task, /deleteMediaObject|DeleteObject|delete\(/, 'the task never deletes an object')
// Message photos are left exactly as sent.
assert.match(task, /item\.kind !== 'message'/)
// Re-encoded originals keep their key and format and lose their metadata; reports carry counts only.
assert.match(task, /REENCODED_METADATA_KEY = 'sns-reencoded'/)
assert.match(task, /image\.jpeg\(\{ quality: 85, mozjpeg: true \}\)/)
assert.doesNotMatch(task, /withMetadata|keepMetadata|keepExif/)
assert.doesNotMatch(task, /log\(`[^`]*\$\{item\.key\}/, 'no storage key is ever logged')

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard the backfill task against a moved branch/)
assert.match(workflow, /Require a deployed image that has the backfill worker/)
assert.match(workflow, /git cat-file -e "\$IMAGE_SHA:scripts\/workers\/media-cdn-backfill\.ts"/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /MEDIA_CDN_BACKFILL_EXPECTED_SHA/)
assert.match(workflow, /MEDIA_CDN_BACKFILL_ACTION/)
assert.match(workflow, /bash scripts\/aws\/media-cdn-backfill\.sh/)

console.log('media CDN backfill runner contract: ok')
