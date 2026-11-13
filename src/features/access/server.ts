import { cache } from 'react'
import { inActionScope, scoped } from '@/lib/server/action-scope'
import { accessRepository } from './repository'
import { canUseCapability, type Capability } from './policy'

export class CapabilityRequiredError extends Error {
  readonly capability: Capability
  readonly companyId?: string

  constructor(capability: Capability, companyId?: string) {
    super('capability_required')
    this.name = 'CapabilityRequiredError'
    this.capability = capability
    this.companyId = companyId
  }
}

/**
 * Round P3: once per server render per member (the Home rail, the feed's "Post as" list and
 * capability checks all ask). Server Actions and route handlers outside a render read fresh.
 */
const renderAccessContext = cache(async (profileId: string) => accessRepository.getAccessContext(profileId))
// Round CAP: inside a Server Action wrapped in actionScope(), once per call per member.
export const getAccessContext = (profileId: string) => (inActionScope()
  ? scoped(`access:${profileId}`, () => accessRepository.getAccessContext(profileId))
  : renderAccessContext(profileId))

export async function userCan(
  profileId: string,
  capability: Capability,
  options: { companyId?: string } = {},
) {
  const access = await getAccessContext(profileId)
  return canUseCapability(access, capability, options)
}

export async function requireCapability(
  profileId: string,
  capability: Capability,
  options: { companyId?: string } = {},
) {
  const access = await getAccessContext(profileId)
  if (!canUseCapability(access, capability, options)) {
    throw new CapabilityRequiredError(capability, options.companyId)
  }
  return access
}
