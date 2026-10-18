/**
 * Round H (H6): the organization page header shows at most one primary and two secondary actions;
 * everything else is in the "…" menu, so the row never wraps. Pure, so the choice is unit-tested.
 */
export type OrganizationHeaderAction = 'manage' | 'follow' | 'message' | 'claim' | 'website' | 'createCommunity' | 'upgrade'

export type OrganizationHeaderActionInput = {
  /** Owner, administrator or another managing role (or the owner of a page still being verified). */
  canManagePage: boolean
  following: boolean
  /** The organization has a contact person other than the viewer. */
  canMessage: boolean
  hasWebsite: boolean
  /** Unclaimed page and the viewer does not belong to it. */
  canClaim: boolean
  canCreateCommunity: boolean
  canUpgrade: boolean
}

export type OrganizationHeaderActions = {
  primary: OrganizationHeaderAction
  /** Shown beside the primary action; on phones only the first one fits, the second moves to the menu. */
  secondary: OrganizationHeaderAction[]
  /** Only in the "…" menu. */
  overflow: OrganizationHeaderAction[]
}

export const MAX_SECONDARY_HEADER_ACTIONS = 2

export function organizationHeaderActions(input: OrganizationHeaderActionInput): OrganizationHeaderActions {
  // Managers: their main admin action is Manage page. Visitors: Follow, or Message once they follow.
  const primary: OrganizationHeaderAction = input.canManagePage
    ? 'manage'
    : input.following && input.canMessage ? 'message' : 'follow'

  const ordered: Array<OrganizationHeaderAction | false> = input.canManagePage
    ? ['follow', input.hasWebsite && 'website', input.canMessage && 'message', input.canClaim && 'claim', input.canCreateCommunity && 'createCommunity', input.canUpgrade && 'upgrade']
    : [
        primary === 'message' && 'follow',
        input.canClaim && 'claim',
        primary === 'follow' && input.canMessage && 'message',
        input.hasWebsite && 'website',
        input.canCreateCommunity && 'createCommunity',
        input.canUpgrade && 'upgrade',
      ]
  const rest = ordered.filter((action): action is OrganizationHeaderAction => Boolean(action))
  return {
    primary,
    secondary: rest.slice(0, MAX_SECONDARY_HEADER_ACTIONS),
    overflow: rest.slice(MAX_SECONDARY_HEADER_ACTIONS),
  }
}
