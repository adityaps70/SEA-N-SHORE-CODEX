import { isRankingEnabled } from '@/features/ranking/switches'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import { calculateProfileCompletion } from '@/features/feed/profile-completion'
import { getChromeCountsForRequest } from './chrome-counts'
import { getProfilePortfolioForRequest, listMemberOrganizationsForRequest } from '@/features/profiles/request-cached-reads'
import { getOwnProfile } from '@/features/profiles/queries'
import type { OwnProfile } from '@/features/profiles/types'
import type { HeaderOrganization } from './account-menu'
import type { HeaderViewer } from './viewer-avatar'

/** The account menu lists a few organizations; the rest are on /organizations. */
export const HEADER_ORGANIZATION_LIMIT = 3

/** Seafarer completion also counts sea service and certificates, as on the Home profile card. */
function completionNeedsPortfolio(profile: OwnProfile) {
  if (profile.persona) return profile.persona === 'seafarer'
  return profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional'
}

function trimmed(value: string | null | undefined) {
  const text = value?.replace(/\s+/g, ' ').trim()
  return text ? text : null
}

/** Everything the signed-in header, phone top bar, side drawer and bottom tabs need, loaded in parallel. */
export async function getAppChromeData(user: AwsVerifiedUser) {
  const [counts, canAccessAdmin, profile, memberships, portfolio, liveSearch] = await Promise.all([
    // Round DB: the Notifications, Messages and Network badges in one query (Round 14, 3.9: only the bell's count;
    // the bell loads its list when it is opened). The Network badge is the same count as the Requests tab on /network.
    getChromeCountsForRequest(user.id),
    canAccessPlatformAdmin(user.id),
    getOwnProfile().catch(() => null),
    // Owners and administrators first. The menu still works (without the list) if this fails.
    listMemberOrganizationsForRequest(user.id).catch(() => []),
    // Only used for the drawer's "Complete profile · n%" line; the drawer omits it if this fails.
    getProfilePortfolioForRequest(user.id).catch(() => null),
    // Round G (G4): search as you type in the top bar (ranking_settings.search; off keeps the plain form).
    isRankingEnabled('search', user.id).catch(() => false),
  ])
  const { notificationUnreadCount, messagingUnreadCount, pendingConnectionRequestCount } = counts
  const profileCompletion = profile && (portfolio || !completionNeedsPortfolio(profile))
    ? calculateProfileCompletion(profile, {
        experienceCount: portfolio?.experiences.length ?? 0,
        credentialCount: portfolio?.credentials.length ?? 0,
      })
    : null
  const viewer: HeaderViewer = {
    name: profile?.fullName ?? user.email ?? 'Member',
    avatarUrl: profile?.avatarUrl ?? null,
    headline: trimmed(profile?.headline),
    organization: trimmed(profile?.currentOrganization?.name ?? profile?.currentCompany),
    location: trimmed(profile?.location),
    profileCompletion,
  }
  const organizations: HeaderOrganization[] = memberships.slice(0, HEADER_ORGANIZATION_LIMIT).map((organization) => ({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    logoUrl: organization.logoUrl,
    canManage: organization.role !== 'member',
  }))
  return {
    notificationUnreadCount,
    messagingUnreadCount,
    canAccessAdmin,
    viewer,
    organizations,
    organizationCount: memberships.length,
    pendingConnectionRequestCount,
    liveSearch,
  }
}

export type AppChromeData = Awaited<ReturnType<typeof getAppChromeData>>

/**
 * Round H (H6): plain chrome for a signed-in member when the counts or profile cannot be loaded.
 * Marketing pages use it so they still render (with the member header) instead of failing.
 */
export function fallbackAppChromeData(user: Pick<AwsVerifiedUser, 'email'>): AppChromeData {
  return {
    notificationUnreadCount: 0,
    messagingUnreadCount: 0,
    canAccessAdmin: false,
    viewer: { name: user.email ?? 'Member', avatarUrl: null, headline: null, organization: null, location: null, profileCompletion: null },
    organizations: [],
    organizationCount: 0,
    pendingConnectionRequestCount: 0,
    liveSearch: false,
  }
}

/** Props for the desktop header, shared by the (app) and (public) layouts so they never drift. */
export function appHeaderProps(chrome: AppChromeData) {
  return {
    unreadCount: chrome.notificationUnreadCount,
    messagingUnreadCount: chrome.messagingUnreadCount,
    canAccessAdmin: chrome.canAccessAdmin,
    viewer: chrome.viewer,
    organizations: chrome.organizations,
    organizationCount: chrome.organizationCount,
    liveSearch: chrome.liveSearch,
  }
}

/** Props for the phone top bar (and its side drawer). */
export function mobileAppHeaderProps(chrome: AppChromeData) {
  return {
    // Round H (H7): the phone top bar carries the Notifications bell; Messages is a bottom tab.
    notificationUnreadCount: chrome.notificationUnreadCount,
    canAccessAdmin: chrome.canAccessAdmin,
    viewer: chrome.viewer,
    organizations: chrome.organizations,
    organizationCount: chrome.organizationCount,
  }
}

/** Props for the phone bottom tabs. */
export function mobileNavProps(chrome: AppChromeData) {
  return {
    messagingUnreadCount: chrome.messagingUnreadCount,
    pendingConnectionRequestCount: chrome.pendingConnectionRequestCount,
  }
}
