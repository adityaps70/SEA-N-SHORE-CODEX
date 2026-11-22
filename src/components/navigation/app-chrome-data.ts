import { isRankingEnabled } from '@/features/ranking/switches'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { countryAdminRepository } from '@/features/country-admins/repository'
import { allows, LIVE_COUNTRY_ADMIN_SECTIONS } from '@/features/country-admins/sections'
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

/**
 * Round GP (Part C follow-up): who gets an Admin entry. Platform administrators (the whole console), else country
 * admins (their countries; the entry opens the organization review queue). A failed lookup shows no entry; the admin
 * pages check access themselves on every load.
 */
async function adminEntry(userId: string): Promise<{ canAccessAdmin: boolean; adminCountries: string[] | null }> {
  if (await canAccessPlatformAdmin(userId)) return { canAccessAdmin: true, adminCountries: null }
  // Round GP Part E: only a country admin with at least one section the console can open gets an entry.
  const access = await countryAdminRepository.getAccess(userId).catch(() => null)
  const usable = access && LIVE_COUNTRY_ADMIN_SECTIONS.some((section) => allows(access.permissions, section))
  return { canAccessAdmin: false, adminCountries: usable && access.countries.length ? access.countries : null }
}

/** Everything the signed-in header, phone top bar, side drawer and bottom tabs need, loaded in parallel. */
export async function getAppChromeData(user: AwsVerifiedUser) {
  const [counts, { canAccessAdmin, adminCountries }, profile, memberships, portfolio, liveSearch] = await Promise.all([
    // Round DB: the Notifications, Messages and Network badges in one query (Round 14, 3.9: only the bell's count;
    // the bell loads its list when it is opened). The Network badge is the same count as the Requests tab on /network.
    getChromeCountsForRequest(user.id),
    adminEntry(user.id),
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
    adminCountries,
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
    adminCountries: null,
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
    adminCountries: chrome.adminCountries,
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
    adminCountries: chrome.adminCountries,
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
