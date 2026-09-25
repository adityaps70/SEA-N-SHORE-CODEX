import { canUseCapability, type AccessContext, type OrganizationAccessRole } from '@/features/access/policy'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'

export type EventPublisherBlocker = 'verification_required' | 'upgrade_required'

export type EventPublisherOption = {
  key: string
  kind: 'personal' | 'organization'
  id: string
  name: string
  slug: string | null
  verified: boolean
  role: OrganizationAccessRole | null
  canPublish: boolean
  blocker: EventPublisherBlocker | null
}

export type EventPersonalPublisherIdentity = {
  profileId: string
  name: string
}

const EVENT_ORGANIZATION_ROLES: readonly OrganizationAccessRole[] = [
  'owner',
  'administrator',
  'event_manager',
]

function personalBlocker(access: AccessContext): EventPublisherBlocker | null {
  if (!access.verifications.includes('event_host')) return 'verification_required'
  return canUseCapability(access, 'event.publish') ? null : 'upgrade_required'
}

function organizationBlocker(
  access: AccessContext,
  organization: UserOrganizationMembershipSummary,
): EventPublisherBlocker | null {
  const membership = access.organizationMemberships.find((entry) => entry.companyId === organization.id)
  if (!membership || !organization.verified || !membership.verified) return 'verification_required'
  return canUseCapability(access, 'event.publish', { companyId: organization.id })
    ? null
    : 'upgrade_required'
}

export function buildEventPublisherOptions(
  access: AccessContext,
  personal: EventPersonalPublisherIdentity,
  organizations: UserOrganizationMembershipSummary[],
): EventPublisherOption[] {
  const personalPublisherBlocker = personalBlocker(access)
  const personalOption: EventPublisherOption = {
    key: `personal:${personal.profileId}`,
    kind: 'personal',
    id: personal.profileId,
    name: personal.name,
    slug: null,
    verified: access.verifications.includes('event_host'),
    role: null,
    canPublish: personalPublisherBlocker === null,
    blocker: personalPublisherBlocker,
  }

  const organizationOptions = organizations
    .filter((organization) => EVENT_ORGANIZATION_ROLES.includes(organization.role))
    .map((organization): EventPublisherOption => {
      const blocker = organizationBlocker(access, organization)
      return {
        key: `organization:${organization.id}`,
        kind: 'organization',
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        verified: organization.verified,
        role: organization.role,
        canPublish: blocker === null,
        blocker,
      }
    })

  return [personalOption, ...organizationOptions]
}
