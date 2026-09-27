import type { AccessContext } from '@/features/access/policy'

/**
 * Who may buy or change a plan. Checked on the server for every billing action.
 * - Creator Pro: any member with an active account, for themselves only.
 * - Organization Pro: only the organization's approved owner or administrator. This
 *   does not need the billing.manage capability (that comes WITH Organization Pro, so a
 *   free organization could otherwise never buy it).
 */

export function canBuyCreatorPro(access: AccessContext) {
  return access.accountActive
}

export function canManageOrganizationBilling(access: AccessContext, companyId: string) {
  if (!access.accountActive || !companyId) return false
  const membership = access.organizationMemberships.find((entry) => entry.companyId === companyId)
  return membership?.role === 'owner' || membership?.role === 'administrator'
}

/** Organization Pro features need a verified organization, so checkout waits for verification. */
export function organizationIsVerified(access: AccessContext, companyId: string) {
  return Boolean(access.organizationMemberships.find((entry) => entry.companyId === companyId)?.verified)
}

export function organizationsUserCanBill(access: AccessContext) {
  return access.organizationMemberships
    .filter((membership) => canManageOrganizationBilling(access, membership.companyId))
    .map((membership) => membership.companyId)
}
