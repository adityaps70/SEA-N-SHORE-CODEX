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

export async function getAccessContext(profileId: string) {
  return accessRepository.getAccessContext(profileId)
}

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
