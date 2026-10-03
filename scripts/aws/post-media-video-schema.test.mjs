import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0008_post_media_video.sql'
const guardPath = 'scripts/aws/post-media-video-migration.sh'
const actionPath = 'scripts/aws/post-media-video-migration-action.txt'
const workflowPath = '.github/workflows/aws-post-media-video-migration.yml'
const approvedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'video/mp4',
  'video/webm',
]

test('post media video migration only widens the existing MIME constraint', () => {
  assert.equal(existsSync(migrationPath), true, `${migrationPath} must exist`)

  const sql = readFileSync(migrationPath, 'utf8')
  const normalized = sql.toLowerCase()
  const statements = normalized
    .split(/^\s*-- statement-breakpoint\s*$/m)
    .map((statement) => statement.trim())
    .filter(Boolean)

  assert.equal(statements.length, 2, 'migration must contain exactly two statements')
  assert.match(
    statements[0],
    /^alter\s+table\s+public\.post_media\s+drop\s+constraint\s+post_media_mime_check\s*;$/i,
  )
  assert.match(
    statements[1],
    /^alter\s+table\s+public\.post_media\s+add\s+constraint\s+post_media_mime_check\s+check\s*\(\s*mime_type\s+in\s*\([\s\S]*\)\s*\)\s*;$/i,
  )

  assert.doesNotMatch(normalized, /\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+[a-z_."]+\s+set\b|\binsert\s+into\b/i)
  assert.doesNotMatch(normalized, /\balter\s+table\s+(?!public\.post_media\b)[a-z_."]+/i)

  const droppedConstraints = [...normalized.matchAll(/\bdrop\s+constraint\s+([a-z0-9_]+)/gi)].map((match) => match[1])
  assert.deepEqual(droppedConstraints, ['post_media_mime_check'])

  const addedConstraints = [...normalized.matchAll(/\badd\s+constraint\s+([a-z0-9_]+)/gi)].map((match) => match[1])
  assert.deepEqual(addedConstraints, ['post_media_mime_check'])

  const mimeTypes = [...normalized.matchAll(/'(image\/(?:jpeg|png|webp)|video\/(?:mp4|webm))'/g)].map((match) => match[1])
  assert.deepEqual(mimeTypes, approvedMimeTypes)

  const quotedValues = [...normalized.matchAll(/'([^']+)'/g)].map((match) => match[1])
  assert.deepEqual(quotedValues, approvedMimeTypes, 'no extra constraint values are allowed')
})

test('post media video migration execution is branch-scoped and safe by default', () => {
  for (const path of [guardPath, actionPath, workflowPath]) {
    assert.equal(existsSync(path), true, `${path} must exist`)
  }

  const action = readFileSync(actionPath, 'utf8').trim()
  assert.ok(['plan', 'apply-once'].includes(action), `Unexpected post media video migration action: ${action}`)

  const guard = readFileSync(guardPath, 'utf8')
  assert.match(guard, /EXPECTED_BRANCH="feat\/aws-native-phase-0-1"/)
  assert.match(guard, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(guard, /CLUSTER_ID="sea-n-shore-staging-aurora"/)
  assert.match(guard, /POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA/)
  assert.match(guard, /git remote get-url origin/)
  assert.match(guard, /https:\/\/github\.com\/adityaps70\/SEA-N-SHORE-CODEX\.git/)
  assert.match(guard, /plan\|apply-once/)
  assert.match(guard, /git ls-remote origin "refs\/heads\/\$EXPECTED_BRANCH"/)
  assert.match(guard, /aws rds-data begin-transaction/)
  assert.match(guard, /pg_get_constraintdef/)
  assert.match(guard, /POST_MEDIA_VIDEO_MIGRATION_APPLY_VERIFIED=true/)
  assert.doesNotMatch(guard, /aws secretsmanager get-secret-value/)

  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /branches:\s*\n\s*- feat\/aws-native-phase-0-1/)
  assert.match(workflow, /infra\/aws\/database\/migrations\/0008_post_media_video\.sql/)
  assert.match(workflow, /scripts\/aws\/post-media-video-migration-action\.txt/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Exact-head AWS Infrastructure CI is not green/)
  assert.match(workflow, /aws-actions\/configure-aws-credentials@v4/)
  assert.match(workflow, /sea-n-shore-bootstrap/)
  assert.match(workflow, /\[\[ "\$COUNT" -eq 1 \]\]/)
  assert.match(workflow, /AWS-RunShellScript/)
  assert.match(workflow, /POST_MEDIA_VIDEO_MIGRATION_EXPECTED_SHA/)
  assert.match(workflow, /bash scripts\/aws\/post-media-video-migration\.sh/)
})
