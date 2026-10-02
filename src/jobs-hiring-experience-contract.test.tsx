import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('premium hiring workspace contract', () => {
  it('provides a unified recruiter overview with personal and organization hiring funnel metrics', () => {
    const page = source('src/app/(app)/hiring/page.tsx')
    const subnav = source('src/features/jobs/components/hiring-subnav.tsx')

    expect(page).toContain('getManagedDashboardMetrics')
    expect(page).toContain('Active Jobs')
    expect(page).toContain('Applicants')
    expect(page).toContain('Shortlisted')
    expect(page).toContain('Interviews')
    expect(page).toContain('Post a job')
    expect(page).toContain('Publishing setup required')
    expect(subnav).toContain('/hiring/jobs')
    expect(subnav).toContain('/organizations')
  })

  it('keeps upgrade and verification paths visible without making organization verification the only hiring route', () => {
    const page = source('src/app/(app)/hiring/page.tsx')

    expect(page).toContain('/plans')
    expect(page).toContain('/organizations')
    expect(page).toContain('Verification and paid plan access are checked separately')
    expect(page).not.toContain('HiringAccessRequired')
  })

  it('lists personal and organization vacancies with applicant and edit workflows', () => {
    const page = source('src/app/(app)/hiring/jobs/page.tsx')
    expect(page).toContain('listManagedJobs')
    expect(page).toContain('publisherName')
    expect(page).toContain('View applicants')
    expect(page).toContain('/applicants')
    expect(page).toContain('/edit')
    expect(page).toContain('Post a job')
  })

  it('provides one structured maritime vacancy composer for create and edit', () => {
    const form = source('src/features/jobs/components/hiring-job-form.tsx')
    expect(form).toContain('createHiringJob')
    expect(form).toContain('updateHiringJob')
    expect(form).toContain('Sea job')
    expect(form).toContain('Shore job')
    expect(form).toContain('Rank / position')
    expect(form).toContain('Vessel types')
    expect(form).toContain('Experience')
    expect(form).toContain('Joining date')
    expect(form).toContain('Last date to apply')
    expect(form).not.toContain('Joining until')
    expect(form).not.toContain('name="joiningUntil"')
    expect(form).toContain('Salary')
    expect(form).toContain('Sailing regions')
    expect(form).toContain('Certificates')
    expect(form).toContain('Visas')
    expect(form).toContain('Urgent joining')
    expect(form).toContain('Easy Apply')
  })

  it('wires authorized create and edit routes to the shared vacancy composer', () => {
    const createPage = source('src/app/(app)/hiring/jobs/new/page.tsx')
    const editPage = source('src/app/(app)/hiring/jobs/[jobId]/edit/page.tsx')

    expect(createPage).toContain('getAccessContext')
    expect(createPage).toContain('listAuthorizedCompanies')
    expect(createPage).toContain('getPersonalPublisher')
    expect(createPage).toContain('buildHiringPublisherOptions')
    expect(createPage).toContain('HiringJobForm')
    expect(editPage).toContain('listManagedJobs')
    expect(editPage).toContain('getEditableJob')
    expect(editPage).toContain('HiringJobForm')
  })

  it('provides a maritime applicant pipeline with deterministic Match context and status filters', () => {
    const page = source('src/app/(app)/hiring/jobs/[jobId]/applicants/page.tsx')
    expect(page).toContain('listApplicants')
    expect(page).toContain('Match')
    expect(page).toContain('Rank')
    expect(page).toContain('Vessel')
    // Members are no longer asked for availability, so recruiters never see it.
    expect(page).not.toContain('Availability')
    expect(page).toContain('under_review')
    expect(page).toContain('shortlisted')
    expect(page).toContain('interview')
    expect(page).toContain('/hiring/applicants/')
  })

  it('provides recruiter candidate review with status actions, explainable fit, timeline and private notes', () => {
    const page = source('src/app/(app)/hiring/applicants/[applicationId]/page.tsx')
    expect(page).not.toContain('Availability')
    const status = source('src/features/jobs/components/hiring-status-action.tsx')
    const notes = source('src/features/jobs/components/recruiter-note-form.tsx')

    expect(page).toContain('getApplicationReview')
    expect(page).toContain('missingRequirements')
    expect(page).toContain('Application timeline')
    expect(page).toContain('Private recruiter notes')
    expect(status).toContain('updateHiringApplicationStatus')
    expect(status).toContain('Shortlist')
    expect(status).toContain('Interview')
    // Owner-facing stages: New, Reviewed, Shortlisted, Interview, Hired, Rejected (Hired is stored as 'selected').
    expect(status).toContain('Mark reviewed')
    expect(status).toContain('Hire')
    expect(status).toContain('Reject')
    expect(notes).toContain('saveHiringRecruiterNote')
  })

  it('routes legacy company management into the shared verified organization workspace', () => {
    const legacyPage = source('src/app/(app)/hiring/company/page.tsx')
    const workspace = source('src/app/(app)/organizations/[slug]/page.tsx')
    // Round 4: the workspace tools moved from the public organization page to its Manage page.
    const manage = source('src/app/(app)/organizations/[slug]/manage/page.tsx')

    expect(legacyPage).toContain("redirect('/organizations/' + company.slug)")
    // The public page shows verification; Manage page shows the viewer's access and the plan.
    expect(workspace).toContain('Verified by Sea N Shore')
    expect(workspace).toContain('organizationManageHref')
    expect(manage).toContain('Verified by Sea N Shore')
    expect(manage).toContain('Your workspace')
    expect(manage).toContain('Organization Pro')
    for (const page of [workspace, manage]) {
      expect(page).not.toContain('is_verified =')
      expect(page).not.toContain('verified_by =')
    }
  })

  it('uses one central Create entry while hiring authorization remains server-side', () => {
    const layout = source('src/app/(app)/layout.tsx')
    const desktopHeader = source('src/components/navigation/app-header.tsx')
    // Phones: the Post tab opens the Create sheet, whose last entry is the same /creator workspace.
    const phoneCreateSheet = source('src/components/navigation/create-sheet.tsx')
    const repository = source('src/features/jobs/hiring-repository.ts')

    expect(layout).not.toContain('canStartHiring')
    // The desktop Create control is a menu whose last entry opens the central /creator workspace.
    expect(desktopHeader).toMatch(/href: '\/creator'/)
    expect(desktopHeader).toContain('Create')
    expect(phoneCreateSheet).toContain("href: '/creator'")
    expect(phoneCreateSheet).toContain('title="Create"')

    expect(repository).toContain('cm.approved_at is not null')
    expect(repository).toContain('cm.role::text = any($2::text[])')
    expect(repository).toContain('c.is_verified = true')
    expect(repository).not.toContain('profile_type')
  })
})
