import { canUseCapability, type AccessContext, type OrganizationAccessRole } from '@/features/access/policy'
import type { UserOrganizationMembershipSummary } from '@/features/organizations/repository'

export type CoursePublisherBlocker = 'verification_required' | 'upgrade_required'

export type CoursePublisherOption = {
  key: string
  kind: 'personal' | 'organization'
  id: string
  name: string
  slug: string | null
  verified: boolean
  role: OrganizationAccessRole | null
  canPublish: boolean
  blocker: CoursePublisherBlocker | null
}

export type CoursePersonalPublisherIdentity = {
  profileId: string
  name: string
}

const LMS_ORGANIZATION_ROLES: readonly OrganizationAccessRole[] = [
  'owner',
  'administrator',
  'lms_manager',
]

function personalBlocker(access: AccessContext): CoursePublisherBlocker | null {
  if (!access.verifications.includes('trainer')) return 'verification_required'
  return canUseCapability(access, 'course.publish') ? null : 'upgrade_required'
}

function organizationBlocker(
  access: AccessContext,
  organization: UserOrganizationMembershipSummary,
): CoursePublisherBlocker | null {
  const membership = access.organizationMemberships.find((entry) => entry.companyId === organization.id)
  if (!membership || !organization.verified || !membership.verified) return 'verification_required'
  return canUseCapability(access, 'course.publish', { companyId: organization.id })
    ? null
    : 'upgrade_required'
}

export function buildCoursePublisherOptions(
  access: AccessContext,
  personal: CoursePersonalPublisherIdentity,
  organizations: UserOrganizationMembershipSummary[],
): CoursePublisherOption[] {
  const personalPublisherBlocker = personalBlocker(access)
  const personalOption: CoursePublisherOption = {
    key: `personal:${personal.profileId}`,
    kind: 'personal',
    id: personal.profileId,
    name: personal.name,
    slug: null,
    verified: access.verifications.includes('trainer'),
    role: null,
    canPublish: personalPublisherBlocker === null,
    blocker: personalPublisherBlocker,
  }

  const organizationOptions = organizations
    .filter((organization) => LMS_ORGANIZATION_ROLES.includes(organization.role))
    .map((organization): CoursePublisherOption => {
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
