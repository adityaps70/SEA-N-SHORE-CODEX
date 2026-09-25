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
    expect(form).toContain('/hiring/organization')
    expect(form).toContain('publisherType')
  })

  it('lists personal and organization jobs together in the hiring workspace', () => {
    const page = source('src/app/(app)/hiring/jobs/page.tsx')

    expect(page).toContain('listManagedJobs')
    expect(page).toContain('publisherName')
    expect(page).not.toContain('listCompanyJobs')
  })
})
