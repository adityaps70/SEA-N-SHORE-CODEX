import { describe, expect, it } from 'vitest'
import { formatMoney, planAccountDeletion, type DeletionFacts } from './plan'

function facts(overrides: Partial<DeletionFacts> = {}): DeletionFacts {
  return {
    posts: 0,
    comments: 0,
    reactions: 0,
    personalJobs: 0,
    personalEvents: 0,
    personalCourses: 0,
    personalCoursesWithLearners: 0,
    upcomingEventsWithRegistrations: 0,
    paidTicketsToRefund: 0,
    organizations: [],
    unpaidEarnings: [],
    autoRenewPlans: [],
    ...overrides,
  }
}

const organization = {
  companyId: '66666666-6666-4666-8666-666666666666',
  name: 'Harbour Academy',
  slug: 'harbour-academy',
  role: 'owner' as const,
  otherActiveManagers: 0,
  jobs: 3,
  events: 1,
  courses: 2,
}

describe('account deletion plan', () => {
  it('keeps an organization that other people manage, exactly as it is', () => {
    const plan = planAccountDeletion(facts({ organizations: [{ ...organization, otherActiveManagers: 2 }] }))
    expect(plan.organizations[0]).toMatchObject({ outcome: 'stays', summary: 'Stays — managed by 2 others' })
    expect(plan.strippedCompanyIds).toEqual([])
    expect(planAccountDeletion(facts({ organizations: [{ ...organization, otherActiveManagers: 1 }] })).organizations[0]!.summary)
      .toBe('Stays — managed by 1 other')
  })

  it('keeps the page but removes the jobs, events and courses of an organization the member alone manages', () => {
    const plan = planAccountDeletion(facts({ organizations: [organization] }))
    expect(plan.organizations[0]).toMatchObject({
      outcome: 'page_only',
      summary: 'Page stays; its 3 jobs, 1 event and 2 courses will be removed',
    })
    expect(plan.strippedCompanyIds).toEqual([organization.companyId])

    const empty = planAccountDeletion(facts({ organizations: [{ ...organization, jobs: 0, events: 0, courses: 0 }] }))
    expect(empty.organizations[0]!.summary).toBe('Page stays; it has no jobs, events or courses to remove')
    const one = planAccountDeletion(facts({ organizations: [{ ...organization, jobs: 1, events: 0, courses: 0 }] }))
    expect(one.organizations[0]!.summary).toBe('Page stays; its 1 job will be removed')
  })

  it('lists the personal data that is deleted, with real counts', () => {
    const plan = planAccountDeletion(facts({ posts: 12, comments: 1, reactions: 40, personalJobs: 2, personalEvents: 1, personalCourses: 3 }))
    expect(plan.deleted).toContain('Your 12 posts, 1 comment and 40 reactions')
    expect(plan.deleted).toContain('2 jobs you posted personally')
    expect(plan.deleted).toContain('1 event you host personally')
    expect(plan.deleted).toContain('3 courses you published personally (removed from Sea N Shore)')
    expect(plan.counts).toMatchObject({ posts: 12, personalJobs: 2 })
  })

  it('says what stays for buyers: enrolled learners, cancelled events and refunds', () => {
    const plan = planAccountDeletion(facts({ personalCoursesWithLearners: 2, upcomingEventsWithRegistrations: 1, paidTicketsToRefund: 3 }))
    expect(plan.stays).toContain('People who already enrolled in your courses keep access to them')
    expect(plan.stays).toContain('1 upcoming event with registrations will be cancelled and attendees told; 3 paid tickets will be refunded in full')
  })

  it('warns about unpaid earnings and auto-renew that will be turned off', () => {
    const plan = planAccountDeletion(facts({
      unpaidEarnings: [{ currency: 'INR', amountMinor: 125000 }, { currency: 'INR', amountMinor: 0 }],
      autoRenewPlans: [{ planLabel: 'Organization Pro', subjectName: 'Harbour Academy' }],
    }))
    expect(plan.warnings).toHaveLength(2)
    expect(plan.warnings[0]).toContain('₹1,250 in earnings')
    expect(plan.warnings[1]).toBe('Auto-renew for Organization Pro (Harbour Academy) will be turned off, so nothing more is charged.')
  })

  it('formats money in the earning’s currency', () => {
    expect(formatMoney(125050, 'INR')).toBe('₹1,250.50')
    expect(formatMoney(2000, 'USD')).toBe('$20')
  })
})
