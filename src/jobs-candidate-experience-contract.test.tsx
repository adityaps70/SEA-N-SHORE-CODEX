import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('premium candidate jobs experience contract', () => {
  it('turns /jobs into maritime discovery with modes, structured filters and profile recommendations', () => {
    const page = source('src/app/(app)/jobs/page.tsx')
    const subnav = source('src/features/jobs/components/jobs-subnav.tsx')
    const controls = source('src/features/jobs/components/jobs-discovery-controls.tsx')
    expect(page).toContain('getJobsDiscovery')
    expect(page).toContain('JOB_DISCOVERY_MODES')
    expect(controls).toContain('Rank / position')
    expect(controls).toContain('Vessel type')
    expect(controls).toContain('Joining within')
    expect(controls).toContain('Minimum salary')
    expect(controls).toContain('Verified employers')
    expect(page).toContain('JobsSubnav')
    expect(subnav).toContain('/jobs/saved')
    expect(subnav).toContain('/jobs/applications')
    expect(subnav).toContain('/jobs/alerts')
  })

  it('makes job cards maritime-specific, trust-aware and match-aware', () => {
    const card = source('src/features/jobs/components/job-card.tsx')
    const applyButton = source('src/features/jobs/components/apply-job-button.tsx')
    expect(card).toContain('JobMatchResult')
    // Round 12: the banded match label (no badge below 40%) instead of a raw score.
    expect(card).toContain('jobMatchDisplay')
    expect(card).toContain('Verified')
    expect(card).toContain('Urgent')
    expect(card).toContain('ApplyJobButton')
    expect(applyButton).toContain('Easy Apply')
    expect(card).toContain('alreadyApplied')
    expect(card).toContain('SaveJobButton')
  })

  it('gives job detail an explainable maritime match and candidate safety controls', () => {
    const page = source('src/app/(app)/jobs/[id]/page.tsx')
    expect(page).toContain('getJobDetailState')
    expect(page).toContain('Your Maritime Match')
    expect(page).toContain('missingRequirements')
    expect(page).toContain('SaveJobButton')
    expect(page).toContain('ReportJobButton')
    // The mobile apply bar sticks just above the fixed bottom navigation.
    expect(page).toContain('sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))]')
  })

  it('provides dedicated saved, applications and alerts workspaces', () => {
    const saved = source('src/app/(app)/jobs/saved/page.tsx')
    const applications = source('src/app/(app)/jobs/applications/page.tsx')
    const alerts = source('src/app/(app)/jobs/alerts/page.tsx')
    const alertForm = source('src/features/jobs/components/job-alert-form.tsx')

    expect(saved).toContain('getSavedJobs')
    expect(saved).toContain('Saved Jobs')
    expect(applications).toContain('getMyJobApplications')
    expect(applications).toContain('Application timeline')
    expect(applications).toContain('JOB_APPLICATION_STATUS_LABELS')
    expect(alerts).toContain('getJobAlerts')
    expect(alerts).toContain('JobAlertForm')
    expect(alertForm).toContain('Create an alert')
  })

  it('gives phones compact jobs screens without removing desktop surfaces (round 8)', () => {
    const page = source('src/app/(app)/jobs/page.tsx')
    expect(page).toContain('<JobsMobileToolbar')
    expect(page).toContain('<JobListRow')
    expect(page).toContain('href="/hiring"')
    expect(page).toContain('JobsDiscoveryControls filters={filters} resultCount={items.length} className="max-md:hidden"')

    for (const route of ['saved', 'applications', 'alerts']) {
      const myJobs = source(`src/app/(app)/jobs/${route}/page.tsx`)
      expect(myJobs).toContain('<MobilePageBar backHref="/jobs" title="My jobs" />')
      expect(myJobs).toContain('<MyJobsChips')
    }
    const applications = source('src/app/(app)/jobs/applications/page.tsx')
    expect(applications).toContain('WithdrawApplicationButton')
    expect(applications).toContain('ApplicationRowMenu')
    expect(source('src/app/(app)/jobs/alerts/page.tsx')).toContain('CreateJobAlertSheet')
  })
})
