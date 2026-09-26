import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8')

test('membership experience is reflected across profile, creator, activities, organizations and learning', () => {
  const profilePage = read('src/app/(app)/profile/page.tsx')
  const profileEditPage = read('src/app/(app)/profile/edit/page.tsx')
  const profileRepository = read('src/features/profiles/repository.ts')
  const appHeader = read('src/components/navigation/app-header.tsx')
  const mobileHeader = read('src/components/navigation/mobile-app-header.tsx')
  const activities = read('src/app/(app)/activities/page.tsx')
  const settingsVerifications = read('src/app/(app)/settings/verifications/page.tsx')
  const learnPage = read('src/app/(app)/learn/page.tsx')
  const hiringOrganization = read('src/app/(app)/hiring/organization/page.tsx')

  assert.match(profileRepository, /p\.persona/)
  assert.match(profileRepository, /p\.profile_intents/)
  assert.match(profilePage, /ProfileMembershipCard/)
  assert.match(profileEditPage, /ProfilePreferencesForm/)

  assert.match(appHeader, /href="\/creator"/)
  assert.match(mobileHeader, /href="\/creator"/)
  assert.match(activities, /tab === 'events'/)
  assert.match(activities, /tab === 'learning'/)

  assert.match(settingsVerifications, /Trainer verification/)
  assert.match(learnPage, /getAccessContext/)
  assert.match(learnPage, /listUserOrganizations/)
  assert.match(learnPage, /Verified trainer/)

  assert.match(hiringOrganization, /redirect\('\/organizations'\)/)
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/organizations/page.tsx')))
  assert.ok(fs.existsSync(path.join(root, 'src/app/(app)/creator/page.tsx')))
})
