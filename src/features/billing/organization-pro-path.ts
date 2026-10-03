import type { AccessContext, OrganizationAccessRole, PlanCode } from '@/features/access/policy'
import type { UserOrganizationState } from '@/features/organizations/types'

/**
 * Where "Get Organization Pro" should take this member, decided on the server from their
 * organizations. Pure: the Plans page, the billing page and their tests share it.
 *
 * - one verified organization they own or administer -> that organization's checkout
 * - several                                            -> the billing page's organization chooser
 * - an organization still waiting for verification     -> the chooser explains, with the status link
 * - only an ordinary member of organizations          -> the chooser says who can upgrade
 * - no organization                                    -> the chooser offers "Create an organization page"
 */

export const ORGANIZATION_PRO_CHOOSER_HREF = '/settings/billing?plan=organization_pro#organization-pro'
export const CREATE_ORGANIZATION_HREF = '/organizations?register=1#register-organization'

export function organizationCheckoutHref(companyId: string) {
  return `/settings/billing/organizations/${companyId}?plan=organization_pro#organization-pro`
}

/** An organization the member owns or administers, with what the billing screens show. */
export type OrganizationProCandidate = {
  id: string
  slug: string
  name: string
  role: Extract<OrganizationAccessRole, 'owner' | 'administrator'>
  verified: boolean
  plan: PlanCode
}

export type OrganizationProPath =
  | { kind: 'restricted'; href: string }
  | { kind: 'single'; href: string; organization: OrganizationProCandidate }
  | { kind: 'choose'; href: string; organizations: OrganizationProCandidate[] }
  | {
      kind: 'unverified'
      href: string
      organizationName: string
      /** Where the member follows the verification: their application or the Organizations page. */
      statusHref: string
      /** The application's review state, or 'not_verified' for an approved page that lost its badge. */
      status: 'pending' | 'changes_requested' | 'rejected' | 'suspended' | 'not_verified'
    }
  | { kind: 'member_only'; href: string; organizationNames: string[] }
  | { kind: 'none'; href: string; createHref: string }

type OrganizationSummary = { id: string; slug: string; name: string }

/** Owner/administrator organizations, with role, plan and verification from the access context. */
export function organizationProCandidates(access: AccessContext, organizations: readonly OrganizationSummary[]): OrganizationProCandidate[] {
  return organizations.flatMap((organization) => {
    const membership = access.organizationMemberships.find((entry) => entry.companyId === organization.id)
    if (!membership || (membership.role !== 'owner' && membership.role !== 'administrator')) return []
    return [{
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      role: membership.role,
      verified: membership.verified,
      plan: membership.plan,
    }]
  })
}

function applicationStatusHref(state: Extract<UserOrganizationState, { kind: 'application' }>) {
  return state.status === 'changes_requested' || state.status === 'rejected'
    ? '/organizations#update-application'
    : '/organizations#your-pages'
}

export function resolveOrganizationProPath(input: {
  access: AccessContext
  /** Approved memberships (organizationRepository.listUserOrganizations). */
  organizations: readonly OrganizationSummary[]
  /** The member's latest organization application. */
  application: UserOrganizationState
}): OrganizationProPath {
  const { access, organizations, application } = input
  if (!access.accountActive) return { kind: 'restricted', href: ORGANIZATION_PRO_CHOOSER_HREF }

  const candidates = organizationProCandidates(access, organizations)
  const verified = candidates.filter((candidate) => candidate.verified)
  if (verified.length === 1) return { kind: 'single', href: organizationCheckoutHref(verified[0].id), organization: verified[0] }
  if (verified.length > 1) return { kind: 'choose', href: ORGANIZATION_PRO_CHOOSER_HREF, organizations: verified }

  const waitingApplication = application.kind === 'application' && application.status !== 'approved' ? application : null
  if (waitingApplication || candidates.length) {
    return {
      kind: 'unverified',
      href: ORGANIZATION_PRO_CHOOSER_HREF,
      organizationName: waitingApplication?.company.name ?? candidates[0].name,
      statusHref: waitingApplication ? applicationStatusHref(waitingApplication) : '/organizations#your-pages',
      status: waitingApplication && waitingApplication.status !== 'approved' ? waitingApplication.status : 'not_verified',
    }
  }

  if (organizations.length) {
    return { kind: 'member_only', href: ORGANIZATION_PRO_CHOOSER_HREF, organizationNames: organizations.map((organization) => organization.name) }
  }
  return { kind: 'none', href: ORGANIZATION_PRO_CHOOSER_HREF, createHref: CREATE_ORGANIZATION_HREF }
}

function listNames(names: readonly string[]) {
  if (names.length <= 1) return names[0] ?? 'your organization'
  if (names.length === 2) return `${names[0]} or ${names[1]}`
  return `${names[0]}, ${names[1]} or another of your organizations`
}

/** The Plans page button for Organization Pro, with one line saying where it leads. */
export function organizationProCallToAction(path: OrganizationProPath): { href: string; label: string; note: string } {
  switch (path.kind) {
    case 'single':
      return path.organization.plan === 'organization_pro'
        ? { href: path.href, label: 'Manage Organization Pro', note: `${path.organization.name} is on Organization Pro.` }
        : { href: path.href, label: 'Get Organization Pro', note: `For ${path.organization.name.replace(/\.+$/, '')}. You choose monthly or yearly on the next screen.` }
    case 'choose':
      return { href: path.href, label: 'Get Organization Pro', note: `Choose which of your ${path.organizations.length} organizations to upgrade.` }
    case 'unverified':
      return {
        href: path.statusHref,
        label: path.status === 'changes_requested' || path.status === 'rejected' ? 'Update your application' : 'View verification status',
        note: path.status === 'suspended'
          ? `${path.organizationName} is suspended. Organization Pro can be bought again once Sea N Shore resolves the review.`
          : `${path.organizationName} isn’t verified yet. You can buy Organization Pro as soon as Sea N Shore verifies it.`,
      }
    case 'member_only':
      return {
        href: '/organizations#your-pages',
        label: 'See your organizations',
        note: `Only an owner or administrator can buy Organization Pro for ${listNames(path.organizationNames)}. Ask one of them to upgrade.`,
      }
    case 'none':
      return {
        href: path.createHref,
        label: 'Create an organization page',
        note: 'Organization Pro is bought for an organization page. Create your organization’s page first (it’s free). Once Sea N Shore verifies it, you can upgrade it.',
      }
    case 'restricted':
      return { href: '/help', label: 'Contact the Sea N Shore team', note: 'Your account is restricted right now, so plans can’t be bought.' }
  }
}
