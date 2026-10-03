import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('member job, event and course actions use the central capability engine', () => {
  const jobs = read('src/features/jobs/actions.ts')
  const events = read('src/features/events/calendar-actions.ts')
  const enrollments = read('src/features/learning/enrollment-actions.ts')

  assert.match(jobs, /userCan\(user\.id, 'job\.apply'\)/)
  assert.match(events, /userCan\(user\.id, 'event\.attend'\)/)
  assert.match(enrollments, /userCan\(user\.id, 'course\.enroll'\)/)

  assert.match(jobs, /Complete your Sea N Shore profile before applying/)
  assert.match(events, /Your account cannot attend events right now/)
  assert.match(enrollments, /Your account cannot enroll in courses right now/)
})
