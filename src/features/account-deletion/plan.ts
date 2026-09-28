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

function plural(count: number, singular: string, pluralWord = `${singular}s`) {
  return `${count} ${count === 1 ? singular : pluralWord}`
}

/** "a, b and c" */
function listing(parts: string[]) {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function formatMoney(amountMinor: number, currency: string) {
  try {
    return new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: amountMinor % 100 === 0 ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(amountMinor / 100)
  } catch {
    return `${currency} ${(amountMinor / 100).toFixed(2)}`
  }
}

function organizationSummary(organization: DeletionOrganizationFacts): string {
  if (organization.otherActiveManagers > 0) {
    return `Stays — managed by ${organization.otherActiveManagers === 1 ? '1 other' : `${organization.otherActiveManagers} others`}`
  }
  const removed = [
    organization.jobs ? plural(organization.jobs, 'job') : null,
    organization.events ? plural(organization.events, 'event') : null,
    organization.courses ? plural(organization.courses, 'course') : null,
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
    facts.posts ? plural(facts.posts, 'post') : null,
    facts.comments ? plural(facts.comments, 'comment') : null,
    facts.reactions ? plural(facts.reactions, 'reaction') : null,
  ].filter((part): part is string => Boolean(part))

  const deleted = [
    'Your profile, photos, experience, certificates, documents and contact details',
    socialParts.length ? `Your ${listing(socialParts)}` : null,
    facts.personalJobs ? `${plural(facts.personalJobs, 'job')} you posted personally` : null,
    facts.personalEvents ? `${plural(facts.personalEvents, 'event')} you host personally` : null,
    facts.personalCourses ? `${plural(facts.personalCourses, 'course')} you published personally (removed from Sea N Shore)` : null,
    'Your job applications, connections, follows, saved items, alerts, learning progress and certificates',
    'Your sign-in details (email, Google and mobile sign-in)',
  ].filter((line): line is string => Boolean(line))

  const stays = [
    facts.personalCoursesWithLearners
      ? `People who already enrolled in your ${facts.personalCoursesWithLearners === 1 ? 'course keep' : 'courses keep'} access to ${facts.personalCoursesWithLearners === 1 ? 'it' : 'them'}`
      : null,
    facts.upcomingEventsWithRegistrations
      ? `${plural(facts.upcomingEventsWithRegistrations, 'upcoming event')} with registrations will be cancelled and attendees told${facts.paidTicketsToRefund ? `; ${plural(facts.paidTicketsToRefund, 'paid ticket')} will be refunded in full` : ''}`
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
