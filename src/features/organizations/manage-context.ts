import { canUseCapability, type AccessContext } from '@/features/access/policy'
import { isOrganizationBillingContact } from '@/features/billing/billing-access'
import { accessRoleLabel } from './access-request-labels'
import { organizationAccessRequestRepository } from './access-request-repository'

/** Navigation state for the Manage page frame on the Team, Branding and Analytics screens. */
export async function loadManageShellContext(userId: string, companyId: string, access: AccessContext) {
  const membership = access.organizationMemberships.find((entry) => entry.companyId === companyId)
  const [viewer, pendingCounts] = await Promise.all([
    organizationAccessRequestRepository.getViewer(userId, companyId).catch(() => null),
    organizationAccessRequestRepository.countPendingForManager(userId).catch(() => ({} as Record<string, number>)),
  ])
  return {
    showRequests: Boolean(viewer),
    pendingRequests: pendingCounts[companyId] ?? 0,
    summary: membership
      ? `${accessRoleLabel(membership.role)} · ${membership.plan === 'organization_pro' ? 'Organization Pro' : 'Free plan'}`
      : null,
    showBilling: isOrganizationBillingContact(access, companyId),
    locked: {
      team: !canUseCapability(access, 'organization.team', { companyId }),
      branding: !canUseCapability(access, 'organization.branding', { companyId }),
      analytics: !canUseCapability(access, 'analytics.view', { companyId }),
    },
  }
}
