import fs from 'node:fs'
import path from 'node:path'
import { test } from 'vitest'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('membership experience is reflected across profile, creator, activities, organizations and learning', () => {
  const profilePage = read('src/app/(app)/profile/page.tsx')
  const profileEditPage = read('src/app/(app)/profile/edit/page.tsx')
  const profileRepository = read('src/features/profiles/repository.ts')
  const profileMembershipCard = read('src/features/profiles/components/profile-membership-card.tsx')
  const appHeader = read('src/components/navigation/app-header.tsx')
  const mobileHeader = read('src/components/navigation/mobile-app-header.tsx')
  const activities = read('src/app/(app)/activities/page.tsx')
  const settingsVerifications = read('src/app/(app)/settings/verifications/page.tsx')
  const learnPage = read('src/app/(app)/learn/page.tsx')
  const hiringOrganization = read('src/app/(app)/hiring/organization/page.tsx')
  const organizationsPage = read('src/app/(app)/organizations/page.tsx')
  const organizationWorkspace = read('src/app/(app)/organizations/[slug]/page.tsx')
  const organizationBranding = read('src/features/organizations/components/organization-branding-form.tsx')

  assert.match(profileRepository, /p\.persona/)
  assert.match(profileRepository, /p\.profile_intents/)
  assert.match(profilePage, /ProfileMembershipCard/)
  assert.match(profileEditPage, /ProfilePreferencesForm/)
  assert.match(profileMembershipCard, /specialization/)
  assert.match(profileMembershipCard, /institutionName/)
  assert.match(profileMembershipCard, /communityRelationship/)
  assert.match(profileMembershipCard, /\/organizations\//)

  assert.match(appHeader, /href="\/creator"/)
  assert.match(mobileHeader, /href="\/creator"/)
  assert.match(activities, /tab === 'events'/)
  assert.match(activities, /tab === 'learning'/)

  assert.match(settingsVerifications, /Trainer verification/)
  assert.match(learnPage, /getAccessContext/)
  assert.match(learnPage, /listUserOrganizations/)
  assert.match(learnPage, /Verified trainer/)

  assert.match(hiringOrganization, /redirect\('\/organizations'\)/)
  assert.match(organizationsPage, /Organization search results/)
  assert.match(organizationsPage, /href={'\/organizations\/' \+ organization\.slug}/)
  assert.match(organizationWorkspace, /unoptimized/)
  assert.match(organizationBranding, /unoptimized/)
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/[slug]/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/[slug]/team/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/[slug]/branding/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/[slug]/analytics/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/creator/page.tsx')))
})
