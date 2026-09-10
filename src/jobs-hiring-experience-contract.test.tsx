import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('premium hiring workspace contract', () => {
  it('provides a recruiter overview with company trust context and hiring funnel metrics', () => {
    const page = source('src/app/(app)/hiring/page.tsx')
    const subnav = source('src/features/jobs/components/hiring-subnav.tsx')

    expect(page).toContain('getDashboardMetrics')
    expect(page).toContain('Active Jobs')
    expect(page).toContain('Applicants')
    expect(page).toContain('Shortlisted')
    expect(page).toContain('Interviews')
    expect(page).toContain('Post a job')
    expect(page).toContain('Verified')
    expect(subnav).toContain('/hiring/jobs')
    expect(subnav).toContain('/hiring/company')
  })

  it('lists company vacancies with applicant and edit workflows', () => {
    const page = source('src/app/(app)/hiring/jobs/page.tsx')
    expect(page).toContain('listCompanyJobs')
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
    expect(form).toContain('Joining')
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

    expect(createPage).toContain('getAuthorizedCompany')
    expect(createPage).toContain('HiringJobForm')
    expect(editPage).toContain('getEditableJob')
    expect(editPage).toContain('HiringJobForm')
  })

  it('provides a maritime applicant pipeline with deterministic Match context and status filters', () => {
    const page = source('src/app/(app)/hiring/jobs/[jobId]/applicants/page.tsx')
    expect(page).toContain('listApplicants')
    expect(page).toContain('Match')
    expect(page).toContain('Rank')
    expect(page).toContain('Vessel')
    expect(page).toContain('Availability')
    expect(page).toContain('under_review')
    expect(page).toContain('shortlisted')
    expect(page).toContain('interview')
    expect(page).toContain('/hiring/applicants/')
  })

  it('provides recruiter candidate review with status actions, explainable fit, timeline and private notes', () => {
    const page = source('src/app/(app)/hiring/applicants/[applicationId]/page.tsx')
    const status = source('src/features/jobs/components/hiring-status-action.tsx')
    const notes = source('src/features/jobs/components/recruiter-note-form.tsx')

    expect(page).toContain('getApplicationReview')
    expect(page).toContain('missingRequirements')
    expect(page).toContain('Application timeline')
    expect(page).toContain('Private recruiter notes')
    expect(status).toContain('updateHiringApplicationStatus')
    expect(status).toContain('Shortlist')
    expect(status).toContain('Interview')
    expect(status).toContain('Select')
    expect(status).toContain('Reject')
    expect(notes).toContain('saveHiringRecruiterNote')
  })
})
