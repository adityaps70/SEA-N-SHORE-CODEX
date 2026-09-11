import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('platform admin organization review experience', () => {
  it('guards the whole admin surface with the authenticated platform administrator authority', () => {
    const layout = source('src/app/(app)/admin/layout.tsx')

    expect(layout).toContain('requireAwsUser')
    expect(layout).toContain('isPlatformAdministrator')
    expect(layout).toContain('notFound()')
    expect(layout).toContain('Sea N Shore Admin')
  })

  it('shows a useful admin dashboard with organization and access queues', () => {
    const page = source('src/app/(app)/admin/page.tsx')

    expect(page).toContain('getAdminDashboardMetrics')
    expect(page).toContain('Pending organizations')
    expect(page).toContain('Changes requested')
    expect(page).toContain('Approved organizations')
    expect(page).toContain('Suspended organizations')
    expect(page).toContain('Pending access requests')
    expect(page).toContain('/admin/organizations')
  })

  it('provides an organization review queue with state filters and review links', () => {
    const page = source('src/app/(app)/admin/organizations/page.tsx')

    expect(page).toContain('listOrganizationApplications')
    expect(page).toContain('Pending')
    expect(page).toContain('Changes requested')
    expect(page).toContain('Approved')
    expect(page).toContain('Rejected')
    expect(page).toContain('Suspended')
    expect(page).toContain('/admin/organizations/')
    expect(page).toContain('Oldest submissions first')
  })

  it('renders the full employer review with explicit approve, change, reject and suspend decisions', () => {
    const page = source('src/app/(app)/admin/organizations/[applicationId]/page.tsx')
    const controls = source('src/features/admin/components/organization-review-actions.tsx')

    expect(page).toContain('getOrganizationApplicationReview')
    expect(page).toContain('Official company email')
    expect(page).toContain('Registration / reference')
    expect(page).toContain('Applicant relationship')
    expect(page).toContain('Fleet summary')
    expect(page).toContain('Vessel types')
    expect(page).toContain('Office locations')
    expect(page).toContain('OrganizationReviewActions')

    expect(controls).toContain('reviewOrganizationApplication')
    expect(controls).toContain('Approve organization')
    expect(controls).toContain('Request changes')
    expect(controls).toContain('Reject application')
    expect(controls).toContain('Suspend hiring access')
    expect(controls).toContain('Reviewer note')
  })
})
