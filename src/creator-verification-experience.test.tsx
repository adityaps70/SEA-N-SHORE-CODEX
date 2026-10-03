import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('creator verification application experience', () => {
  it('provides one Settings overview for recruiter and event-host verification', () => {
    const page = source('src/app/(app)/settings/verifications/page.tsx')

    expect(page).toContain("getState(user.id, 'recruiter')")
    expect(page).toContain("getState(user.id, 'event_host')")
    expect(page).toContain('Recruiter verification')
    expect(page).toContain('Event Host verification')
    expect(page).toContain('/settings/verifications/recruiter')
    expect(page).toContain('/settings/verifications/event-host')
    expect(page).toContain('Verification does not activate a paid plan')
  })

  it('renders a reusable evidence form for recruiter and event-host applications', () => {
    const page = source('src/app/(app)/settings/verifications/[verificationType]/page.tsx')
    const form = source('src/features/verifications/components/creator-verification-form.tsx')

    expect(page).toContain('CreatorVerificationForm')
    expect(page).toContain('creatorVerificationRepository.getState')
    expect(page).toContain('getOwnProfileFromAurora')
    expect(form).toContain('submitCreatorVerification')
    expect(form).toContain('professionalRole')
    expect(form).toContain('specializations')
    expect(form).toContain('experienceSummary')
    expect(form).toContain('evidenceUrl')
    expect(form).toContain('Your entries are preserved')
  })

  it('gives admins a dedicated verification queue with approve/reject controls', () => {
    const page = source('src/app/(app)/admin/verifications/page.tsx')
    const controls = source('src/features/verifications/components/creator-verification-review-actions.tsx')

    expect(page).toContain('listAdminApplications')
    expect(page).toContain('Recruiter')
    expect(page).toContain('Event Host')
    expect(page).toContain('CreatorVerificationReviewActions')
    expect(controls).toContain('reviewCreatorVerificationApplication')
    expect(controls).toContain('Approve verification')
    expect(controls).toContain('Reject')
  })

  it('links verification-required publisher blockers to the correct application', () => {
    const jobs = source('src/features/jobs/components/hiring-job-form.tsx')
    const events = source('src/features/events/components/event-form.tsx')

    expect(jobs).toContain('/settings/verifications/recruiter')
    expect(events).toContain('/settings/verifications/event-host')
  })

  it('surfaces verification management from Settings and Admin', () => {
    const settings = source('src/app/(app)/settings/page.tsx')
    const admin = source('src/app/(app)/admin/page.tsx')

    expect(settings).toContain('/settings/verifications')
    expect(admin).toContain('/admin/verifications')
  })
})
