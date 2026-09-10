import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('premium candidate jobs experience contract', () => {
  it('turns /jobs into maritime discovery with modes, structured filters and profile recommendations', () => {
    const page = source('src/app/(app)/jobs/page.tsx')
    expect(page).toContain('getJobsDiscovery')
    expect(page).toContain('JOB_DISCOVERY_MODES')
    expect(page).toContain('Rank / position')
    expect(page).toContain('Vessel type')
    expect(page).toContain('Joining within')
    expect(page).toContain('Minimum salary')
    expect(page).toContain('Verified employers')
    expect(page).toContain('/jobs/saved')
    expect(page).toContain('/jobs/applications')
    expect(page).toContain('/jobs/alerts')
  })

  it('makes job cards maritime-specific, trust-aware and match-aware', () => {
    const card = source('src/features/jobs/components/job-card.tsx')
    expect(card).toContain('JobMatchResult')
    expect(card).toContain('match.score')
    expect(card).toContain('Verified')
    expect(card).toContain('Urgent')
    expect(card).toContain('Easy Apply')
    expect(card).toContain('SaveJobButton')
  })

  it('gives job detail an explainable maritime match and candidate safety controls', () => {
    const page = source('src/app/(app)/jobs/[id]/page.tsx')
    expect(page).toContain('getJobDetailState')
    expect(page).toContain('Your Maritime Match')
    expect(page).toContain('missingRequirements')
    expect(page).toContain('SaveJobButton')
    expect(page).toContain('ReportJobButton')
    expect(page).toContain('sticky bottom-0')
  })

  it('provides dedicated saved, applications and alerts workspaces', () => {
    const saved = source('src/app/(app)/jobs/saved/page.tsx')
    const applications = source('src/app/(app)/jobs/applications/page.tsx')
    const alerts = source('src/app/(app)/jobs/alerts/page.tsx')

    expect(saved).toContain('getSavedJobs')
    expect(saved).toContain('Saved Jobs')
    expect(applications).toContain('getMyJobApplications')
    expect(applications).toContain('Application timeline')
    expect(applications).toContain('JOB_APPLICATION_STATUS_LABELS')
    expect(alerts).toContain('getJobAlerts')
    expect(alerts).toContain('Create an alert')
    expect(alerts).toContain('JobAlertForm')
  })
})
