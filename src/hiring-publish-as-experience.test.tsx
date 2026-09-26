import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('hiring publish-as experience', () => {
  it('builds publisher choices from personal and organization access instead of selecting one company', () => {
    const page = source('src/app/(app)/hiring/jobs/new/page.tsx')

    expect(page).toContain('getAccessContext')
    expect(page).toContain('getPersonalPublisher')
    expect(page).toContain('listAuthorizedCompanies')
    expect(page).toContain('buildHiringPublisherOptions')
    expect(page).toContain('publisherOptions')
    expect(page).not.toContain('getAuthorizedCompany(user.id)')
  })

  it('shows Publish as and clear upgrade or verification blockers in the create form', () => {
    const form = source('src/features/jobs/components/hiring-job-form.tsx')

    expect(form).toContain('Publish as')
    expect(form).toContain('publisherOptions')
    expect(form).toContain('verification_required')
    expect(form).toContain('upgrade_required')
    expect(form).toContain('/plans')
    expect(form).toContain('/organizations')
    expect(form).toContain('publisherType')
  })

  it('lists personal and organization jobs together in the hiring workspace', () => {
    const page = source('src/app/(app)/hiring/jobs/page.tsx')

    expect(page).toContain('listManagedJobs')
    expect(page).toContain('publisherName')
    expect(page).not.toContain('listCompanyJobs')
  })

  it('uses a unified hiring overview for personal and organization vacancies', () => {
    const page = source('src/app/(app)/hiring/page.tsx')

    expect(page).toContain('getManagedDashboardMetrics')
    expect(page).toContain('listManagedJobs')
    expect(page).toContain('buildHiringPublisherOptions')
    expect(page).not.toContain('HiringAccessRequired')
  })

  it('loads edit and applicant pages through the managed publisher identity instead of the first company', () => {
    const editPage = source('src/app/(app)/hiring/jobs/[jobId]/edit/page.tsx')
    const applicantsPage = source('src/app/(app)/hiring/jobs/[jobId]/applicants/page.tsx')

    expect(editPage).toContain('listManagedJobs')
    expect(editPage).toContain('jobSummary.companyId')
    expect(editPage).not.toContain('getAuthorizedCompany(user.id)')

    expect(applicantsPage).toContain('listManagedJobs')
    expect(applicantsPage).toContain('job.publisherName')
    expect(applicantsPage).not.toContain('listCompanyJobs')
  })

  it('keeps the central Create workspace visible without module-specific hiring gates', () => {
    const desktopHeader = source('src/components/navigation/app-header.tsx')
    const mobileHeader = source('src/components/navigation/mobile-app-header.tsx')
    const layout = source('src/app/(app)/layout.tsx')

    expect(desktopHeader).toContain('href="/creator"')
    expect(desktopHeader).toContain('Create')
    expect(mobileHeader).toContain('href="/creator"')
    expect(mobileHeader).toContain('Create')
    expect(layout).not.toContain('canStartHiring')
    expect(layout).not.toContain('getAuthorizedCompany')
  })

})
