import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('Organization Pro workspace exposes team, branding and analytics through central capabilities', () => {
  for (const file of [
    'src/app/(app)/organizations/[slug]/page.tsx',
    'src/app/(app)/organizations/[slug]/team/page.tsx',
    'src/app/(app)/organizations/[slug]/branding/page.tsx',
    'src/app/(app)/organizations/[slug]/analytics/page.tsx',
  ]) assert.ok(fs.existsSync(path.join(root, file)), file)

  const actions = read('src/features/organizations/workspace-actions.ts')
  const repository = read('src/features/organizations/workspace-repository.ts')
  const teamPage = read('src/app/(app)/organizations/[slug]/team/page.tsx')
  const brandingPage = read('src/app/(app)/organizations/[slug]/branding/page.tsx')
  const analyticsPage = read('src/app/(app)/organizations/[slug]/analytics/page.tsx')

  assert.match(actions, /requireCapability\(user\.id, 'organization\.team'/)
  assert.match(actions, /requireCapability\(user\.id, 'organization\.branding'/)
  assert.match(teamPage, /organization\.team/)
  assert.match(brandingPage, /organization\.branding/)
  assert.match(analyticsPage, /analytics\.view/)
  assert.match(repository, /company_members/)
  assert.match(repository, /learning_enrollments/)
  assert.match(repository, /event_attendees/)
  assert.match(repository, /job_applications/)
})
