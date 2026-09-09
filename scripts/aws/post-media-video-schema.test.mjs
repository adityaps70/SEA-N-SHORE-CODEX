import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const migrationPath = 'infra/aws/database/migrations/0008_post_media_video.sql'
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
