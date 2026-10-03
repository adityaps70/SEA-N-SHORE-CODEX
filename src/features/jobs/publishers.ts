import { canUseCapability, type AccessContext } from '@/features/access/policy'
import type { HiringRole } from './hiring-repository'

export type HiringPersonalPublisherIdentity = {
  profileId: string
  name: string
}

export type HiringOrganizationPublisherIdentity = {
  id: string
  name: string
  slug: string
  verified: boolean
  role: HiringRole
}

export type HiringPublisherOption = {
  key: string
  kind: 'personal' | 'organization'
  id: string
  name: string
  verified: boolean
  role: HiringRole | null
  canPublish: boolean
  blocker: 'verification_required' | 'upgrade_required' | null
}

function personalBlocker(access: AccessContext): HiringPublisherOption['blocker'] {
  if (!access.verifications.includes('recruiter')) return 'verification_required'
  return canUseCapability(access, 'job.publish') ? null : 'upgrade_required'
}

function organizationBlocker(
  access: AccessContext,
  companyId: string,
): HiringPublisherOption['blocker'] {
  const membership = access.organizationMemberships.find((entry) => entry.companyId === companyId)
  if (!membership?.verified) return 'verification_required'
  return canUseCapability(access, 'job.publish', { companyId }) ? null : 'upgrade_required'
}

export function buildHiringPublisherOptions(
  access: AccessContext,
  personal: HiringPersonalPublisherIdentity,
  organizations: HiringOrganizationPublisherIdentity[],
): HiringPublisherOption[] {
  const personalBlock = personalBlocker(access)
  const options: HiringPublisherOption[] = [{
    key: `personal:${personal.profileId}`,
    kind: 'personal',
    id: personal.profileId,
    name: personal.name,
    verified: access.verifications.includes('recruiter'),
    role: null,
    canPublish: personalBlock === null,
    blocker: personalBlock,
  }]

  for (const organization of organizations) {
    const blocker = organizationBlocker(access, organization.id)
    options.push({
      key: `organization:${organization.id}`,
      kind: 'organization',
      id: organization.id,
      name: organization.name,
      verified: organization.verified,
      role: organization.role,
      canPublish: blocker === null,
      blocker,
    })
  }

  return options
}
