import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccessContext, Capability, OrganizationAccessMembership, VerificationType } from '@/features/access/policy'
import { CreateRequirementsBanner, getCreateRequirements, type CreateKind } from './create-requirements-banner'

const PRO: Capability[] = ['job.apply', 'event.attend', 'course.enroll', 'job.publish', 'event.publish', 'course.publish']
const FREE: Capability[] = ['job.apply', 'event.attend', 'course.enroll']

function access(overrides: Partial<AccessContext> = {}): AccessContext {
  return {
    personalPlan: 'free',
    personalEntitlements: FREE,
    verifications: [],
    organizationMemberships: [],
    accountActive: true,
    ...overrides,
  }
}

function membership(overrides: Partial<OrganizationAccessMembership> = {}): OrganizationAccessMembership {
  return {
    companyId: '99999999-9999-4999-8999-999999999999',
    plan: 'organization_pro',
    role: 'owner',
    verified: true,
    entitlements: ['job.publish', 'event.publish', 'course.publish', 'organization.manage'],
    ...overrides,
  }
}

const KINDS: Array<{ kind: CreateKind; verification: VerificationType; verifyHref: string; verifyLabel: string }> = [
  { kind: 'job', verification: 'recruiter', verifyHref: '/settings/verifications/recruiter', verifyLabel: 'Get verified as a recruiter' },
  { kind: 'event', verification: 'event_host', verifyHref: '/settings/verifications/event-host', verifyLabel: 'Get verified as an Event Host' },
  { kind: 'course', verification: 'trainer', verifyHref: '/learn/teach', verifyLabel: 'Get verified as a trainer' },
]

afterEach(() => cleanup())

describe('getCreateRequirements', () => {
  for (const { kind, verification, verifyHref } of KINDS) {
    describe(kind, () => {
      it('lists verification and plan when the member has neither', () => {
        expect(getCreateRequirements(access(), kind).map((item) => [item.id, item.href])).toEqual([
          ['verification', verifyHref],
          ['plan', '/plans'],
        ])
      })

      it('lists only verification when the member already has Creator Pro', () => {
        expect(getCreateRequirements(access({ personalPlan: 'creator_pro', personalEntitlements: PRO }), kind).map((item) => item.id)).toEqual(['verification'])
      })

      it('lists only the plan when the member is verified but on the free plan', () => {
        expect(getCreateRequirements(access({ verifications: [verification] }), kind).map((item) => item.id)).toEqual(['plan'])
      })

      it('lists nothing when the member is verified and has Creator Pro', () => {
        expect(getCreateRequirements(access({ personalPlan: 'creator_pro', personalEntitlements: PRO, verifications: [verification] }), kind)).toEqual([])
      })

      it('lists nothing when the member can publish for an organization they manage', () => {
        expect(getCreateRequirements(access({ organizationMemberships: [membership()] }), kind)).toEqual([])
      })
    })
  }

  it('ignores a verification for a different role', () => {
    expect(getCreateRequirements(access({ verifications: ['event_host'], personalEntitlements: PRO }), 'job').map((item) => item.id)).toEqual(['verification'])
  })

  it('still shows requirements when the organization cannot publish (unverified company, wrong role or no plan)', () => {
    for (const org of [
      membership({ verified: false }),
      membership({ role: 'analyst' }),
      membership({ role: 'event_manager' }),
      membership({ plan: 'free', entitlements: [] }),
    ]) {
      expect(getCreateRequirements(access({ organizationMemberships: [org] }), 'job').map((item) => item.id)).toEqual(['verification', 'plan'])
    }
  })

  it('counts an organization role that matches the thing being created', () => {
    expect(getCreateRequirements(access({ organizationMemberships: [membership({ role: 'lms_manager' })] }), 'course')).toEqual([])
    expect(getCreateRequirements(access({ organizationMemberships: [membership({ role: 'lms_manager' })] }), 'event')).not.toEqual([])
  })

  it('explains a paused account first, and never lists items the member already has', () => {
    const inactive = access({ accountActive: false, personalPlan: 'creator_pro', personalEntitlements: PRO, verifications: ['recruiter'], organizationMemberships: [membership()] })
    expect(getCreateRequirements(inactive, 'job').map((item) => item.id)).toEqual(['account'])
  })
})

describe('CreateRequirementsBanner', () => {
  it('renders nothing when the member can already publish', () => {
    const { container } = render(<CreateRequirementsBanner access={access({ personalEntitlements: PRO, verifications: ['recruiter'] })} kind="job" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('lists each missing item with a direct link and says a draft can be saved now', () => {
    render(<CreateRequirementsBanner access={access()} kind="event" />)

    const banner = screen.getByRole('region', { name: 'To publish this event, you still need:' })
    const items = within(banner).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('Get verified as an Event Host')
    expect(within(items[0] as HTMLElement).getByRole('link', { name: 'Get verified' })).toHaveAttribute('href', '/settings/verifications/event-host')
    expect(items[1]).toHaveTextContent('Creator Pro to publish under your own name')
    expect(within(items[1] as HTMLElement).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
    expect(banner).toHaveTextContent('You can save a draft now')
  })

  it('shows only the plan link to a verified trainer without a plan', () => {
    render(<CreateRequirementsBanner access={access({ verifications: ['trainer'] })} kind="course" />)

    const banner = screen.getByRole('region', { name: 'To publish this course, you still need:' })
    expect(within(banner).queryByRole('link', { name: 'Get verified' })).not.toBeInTheDocument()
    expect(within(banner).getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
  })

  it('shows only the verification link to a Creator Pro member who is not yet a verified recruiter', () => {
    render(<CreateRequirementsBanner access={access({ personalPlan: 'creator_pro', personalEntitlements: PRO })} kind="job" />)

    const banner = screen.getByRole('region', { name: 'To publish this job, you still need:' })
    expect(within(banner).getByRole('link', { name: 'Get verified' })).toHaveAttribute('href', '/settings/verifications/recruiter')
    expect(within(banner).queryByRole('link', { name: 'See plans' })).not.toBeInTheDocument()
  })

  it('is placed at the top of all three create pages', () => {
    const pages: Array<[string, CreateKind]> = [
      ['src/app/(app)/hiring/jobs/new/page.tsx', 'job'],
      ['src/app/(app)/events/create/page.tsx', 'event'],
      ['src/app/(app)/learn/studio/courses/new/page.tsx', 'course'],
    ]
    for (const [path, kind] of pages) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8')
      expect(source).toContain(`<CreateRequirementsBanner access={access} kind="${kind}"`)
    }
  })
})

const OCEANIC = { id: '99999999-9999-4999-8999-999999999999', name: 'Oceanic Ship Management', slug: 'oceanic-ship-management' }
const FREE_ORG: Capability[] = ['organization.manage']

describe('Or upgrade <organization> to Organization Pro', () => {
  it('offers the upgrade to the owner of a verified organization on the free plan', () => {
    const member = access({ organizationMemberships: [membership({ plan: 'free', entitlements: FREE_ORG })] })
    for (const kind of ['job', 'event', 'course'] as const) {
      const option = getCreateRequirements(member, kind, [OCEANIC]).find((item) => item.id === 'organization')
      expect(option).toEqual({
        id: 'organization',
        label: 'Or upgrade Oceanic Ship Management to Organization Pro',
        href: '/organizations/oceanic-ship-management/manage?section=billing',
        linkLabel: 'Upgrade',
      })
    }
  })

  it('offers it to administrators too, but only when upgrading would unlock publishing', () => {
    const admin = access({ organizationMemberships: [membership({ plan: 'free', role: 'administrator', entitlements: FREE_ORG })] })
    expect(getCreateRequirements(admin, 'job', [OCEANIC]).map((item) => item.id)).toContain('organization')

    const recruiter = access({ organizationMemberships: [membership({ plan: 'free', role: 'recruiter', entitlements: FREE_ORG })] })
    expect(getCreateRequirements(recruiter, 'job', [OCEANIC]).map((item) => item.id)).not.toContain('organization')

    const unverified = access({ organizationMemberships: [membership({ plan: 'free', verified: false, entitlements: FREE_ORG })] })
    expect(getCreateRequirements(unverified, 'job', [OCEANIC]).map((item) => item.id)).not.toContain('organization')

    const restricted = access({ accountActive: false, organizationMemberships: [membership({ plan: 'free', entitlements: FREE_ORG })] })
    expect(getCreateRequirements(restricted, 'job', [OCEANIC]).map((item) => item.id)).not.toContain('organization')

    // Already on Organization Pro: the member can publish as the organization, so no banner at all.
    expect(getCreateRequirements(access({ organizationMemberships: [membership()] }), 'job', [OCEANIC])).toEqual([])
  })

  it('shows the option in the banner with a direct Upgrade link', () => {
    render(
      <CreateRequirementsBanner
        access={access({ organizationMemberships: [membership({ plan: 'free', entitlements: FREE_ORG })] })}
        kind="job"
        organizations={[OCEANIC]}
      />,
    )
    const banner = screen.getByRole('region', { name: 'To publish this job, you still need:' })
    const option = within(banner).getByText('Or upgrade Oceanic Ship Management to Organization Pro').closest('li') as HTMLElement
    expect(within(option).getByRole('link', { name: 'Upgrade' })).toHaveAttribute('href', '/organizations/oceanic-ship-management/manage?section=billing')
  })

  it('passes the member’s organizations from all three create pages', () => {
    for (const path of ['src/app/(app)/hiring/jobs/new/page.tsx', 'src/app/(app)/events/create/page.tsx', 'src/app/(app)/learn/studio/courses/new/page.tsx']) {
      expect(readFileSync(resolve(process.cwd(), path), 'utf8')).toContain('organizations={organizations}')
    }
  })
})
