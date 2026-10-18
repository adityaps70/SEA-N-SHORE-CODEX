/**
 * What deleting an account does, decided from the member's real data. Pure: the
 * delete-account screen shows this plan and the deletion executes the same plan.
 *
 * Owner's rules:
 * - Personal data goes: profile, personal posts, comments and reactions, jobs, events
 *   and courses posted personally, media, sign-in identities.
 * - An organization the member manages (owner or administrator) with at least one
 *   OTHER active owner/administrator stays exactly as it is.
 * - An organization the member is the ONLY manager of keeps its page (name, logo, about,
 *   followers) but its jobs, events and courses are removed; it becomes unmanaged.
 * - Buyers keep access: enrolled learners keep removed courses, ticket holders keep
 *   registrations; upcoming events with registrations are cancelled instead of deleted,
 *   paid tickets are refunded and attendees are told.
 * - Organization rows are never deleted.
 */

import { formatMoney } from '@/features/payments/currency'
import { pluralize } from '@/lib/format'

export type DeletionOrganizationFacts = {
  companyId: string
  name: string
  slug: string | null
  role: 'owner' | 'administrator'
  /** Other approved owners/administrators whose accounts are active. */
  otherActiveManagers: number
  jobs: number
  events: number
  courses: number
}

export type DeletionFacts = {
  posts: number
  comments: number
  reactions: number
  personalJobs: number
  personalEvents: number
  personalCourses: number
  /** Personal courses with learners (active or completed enrollments). */
  personalCoursesWithLearners: number
  /** Upcoming events (personal, or of organizations losing their only manager) with registrations. */
  upcomingEventsWithRegistrations: number
  /** Paid tickets on those events. */
  paidTicketsToRefund: number
  organizations: DeletionOrganizationFacts[]
  /** Earnings not yet paid out to the member (pending, available or in a payout). */
  unpaidEarnings: Array<{ currency: string; amountMinor: number }>
  /** Auto-renewing plans paid with the member's mandate (turned off before deletion). */
  autoRenewPlans: Array<{ planLabel: string; subjectName: string | null }>
}

export type OrganizationOutcome = {
  companyId: string
  name: string
  slug: string | null
  outcome: 'stays' | 'page_only'
  otherActiveManagers: number
  jobs: number
  events: number
  courses: number
  /** e.g. "Stays — managed by 2 others" / "Page stays; its 3 jobs, 1 event and 2 courses will be removed". */
  summary: string
}

export type AccountDeletionPlan = {
  deleted: string[]
  stays: string[]
  organizations: OrganizationOutcome[]
  /** Organizations whose jobs, events and courses are removed (the member is their only manager). */
  strippedCompanyIds: string[]
  warnings: string[]
  counts: {
    posts: number
    comments: number
    reactions: number
    personalJobs: number
    personalEvents: number
    personalCourses: number
    upcomingEventsWithRegistrations: number
    paidTicketsToRefund: number
  }
}

/** "a, b and c" */
function listing(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

// Round H (H7): the site-wide money formatter, still exported here for existing imports.
export { formatMoney }

function organizationSummary(organization: DeletionOrganizationFacts): string {
  if (organization.otherActiveManagers > 0) {
    return `Stays — managed by ${organization.otherActiveManagers === 1 ? '1 other' : `${organization.otherActiveManagers} others`}`
  }
  const removed = [
    organization.jobs ? pluralize(organization.jobs, 'job') : null,
    organization.events ? pluralize(organization.events, 'event') : null,
    organization.courses ? pluralize(organization.courses, 'course') : null,
  ].filter((part): part is string => Boolean(part))
  return removed.length
    ? `Page stays; its ${listing(removed)} will be removed`
    : 'Page stays; it has no jobs, events or courses to remove'
}

export function planAccountDeletion(facts: DeletionFacts): AccountDeletionPlan {
  const organizations: OrganizationOutcome[] = facts.organizations.map((organization) => ({
    companyId: organization.companyId,
    name: organization.name,
    slug: organization.slug,
    outcome: organization.otherActiveManagers > 0 ? 'stays' : 'page_only',
    otherActiveManagers: organization.otherActiveManagers,
    jobs: organization.jobs,
    events: organization.events,
    courses: organization.courses,
    summary: organizationSummary(organization),
  }))

  const socialParts = [
    facts.posts ? pluralize(facts.posts, 'post') : null,
    facts.comments ? pluralize(facts.comments, 'comment') : null,
    facts.reactions ? pluralize(facts.reactions, 'reaction') : null,
  ].filter((part): part is string => Boolean(part))

  const deleted = [
    'Your profile, photos, experience, certificates, documents and contact details',
    socialParts.length ? `Your ${listing(socialParts)}` : null,
    facts.personalJobs ? `${pluralize(facts.personalJobs, 'job')} you posted personally` : null,
    facts.personalEvents ? `${pluralize(facts.personalEvents, 'event')} you host personally` : null,
    facts.personalCourses ? `${pluralize(facts.personalCourses, 'course')} you published personally (removed from Sea N Shore)` : null,
    'Your job applications, connections, follows, saved items, alerts, learning progress and certificates',
    'Your sign-in details (email, Google and mobile sign-in)',
  ].filter((line): line is string => Boolean(line))

  const stays = [
    facts.personalCoursesWithLearners
      ? `People who already enrolled in your ${facts.personalCoursesWithLearners === 1 ? 'course keep' : 'courses keep'} access to ${facts.personalCoursesWithLearners === 1 ? 'it' : 'them'}`
      : null,
    facts.upcomingEventsWithRegistrations
      ? `${pluralize(facts.upcomingEventsWithRegistrations, 'upcoming event')} with registrations will be cancelled and attendees told${facts.paidTicketsToRefund ? `; ${pluralize(facts.paidTicketsToRefund, 'paid ticket')} will be refunded in full` : ''}`
      : null,
    'Messages you sent are removed; conversations stay for the other people in them',
    'Payment and safety records we have to keep, with your name removed',
  ].filter((line): line is string => Boolean(line))

  const warnings: string[] = []
  for (const earning of facts.unpaidEarnings.filter((entry) => entry.amountMinor > 0)) {
    warnings.push(`You have ${formatMoney(earning.amountMinor, earning.currency)} in earnings that hasn’t been paid out yet. It can’t be paid to you after your account is deleted, so request a payout or contact info@beaufortmarine.in first.`)
  }
  for (const plan of facts.autoRenewPlans) {
    warnings.push(`Auto-renew for ${plan.planLabel}${plan.subjectName ? ` (${plan.subjectName})` : ''} will be turned off, so nothing more is charged.`)
  }

  return {
    deleted,
    stays,
    organizations,
    strippedCompanyIds: organizations.filter((organization) => organization.outcome === 'page_only').map((organization) => organization.companyId),
    warnings,
    counts: {
      posts: facts.posts,
      comments: facts.comments,
      reactions: facts.reactions,
      personalJobs: facts.personalJobs,
      personalEvents: facts.personalEvents,
      personalCourses: facts.personalCourses,
      upcomingEventsWithRegistrations: facts.upcomingEventsWithRegistrations,
      paidTicketsToRefund: facts.paidTicketsToRefund,
    },
  }
}
