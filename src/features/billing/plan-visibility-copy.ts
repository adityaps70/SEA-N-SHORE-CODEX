import { organizationCheckoutHref } from './organization-pro-path'

/** Owner-facing copy for an item hidden from everyone else because the plan ended. Safe in client components. */
export const PLAN_HIDDEN_MESSAGE = 'Hidden because your plan ended — renew to restore'

export const CREATOR_PRO_CHECKOUT_HREF = '/settings/billing?plan=creator_pro#creator-pro'

/** Where the owner renews: Organization Pro for organization items, Creator Pro for personal ones. */
export function planRenewHref(owner: { companyId: string | null }) {
  return owner.companyId ? organizationCheckoutHref(owner.companyId) : CREATOR_PRO_CHECKOUT_HREF
}
