/** Client-safe network-count types, rules and links (no database imports). */

export const PROFILE_NETWORK_LISTS = ['connections', 'followers', 'following'] as const
export type ProfileNetworkList = (typeof PROFILE_NETWORK_LISTS)[number]

export type ProfileNetworkCounts = {
  connections: number
  followers: number
  following: number
}

/**
 * What a viewer may see about a member's network:
 * - counts: any signed-in member;
 * - the lists behind them: the member themself and their accepted connections.
 * Signed-out visitors see neither. Sea N Shore has no per-member network
 * privacy setting yet (contact visibility covers contact details only), so
 * this is the platform-wide rule and the UI states it next to the numbers.
 */
export type ProfileNetworkSummary = {
  counts: ProfileNetworkCounts
  isOwner: boolean
  canViewLists: boolean
}

export const PROFILE_NETWORK_LIST_LIMIT = 100

export function parseProfileNetworkList(value: unknown): ProfileNetworkList {
  return PROFILE_NETWORK_LISTS.find((entry) => entry === value) ?? 'connections'
}

/** Where each count links: the owner's own network hub, or the member's list page. */
export function profileNetworkListHref(list: ProfileNetworkList, target: { isOwner: boolean; slug: string }) {
  if (target.isOwner) {
    if (list === 'connections') return '/network?tab=connections'
    return `/network?tab=following&view=${list}`
  }
  return `/people/${encodeURIComponent(target.slug)}/network?view=${list}`
}
