import { canAccessPlatformAdmin } from '@/features/admin/access'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import { calculateProfileCompletion } from '@/features/feed/profile-completion'
import { getUnreadMessageCount } from '@/features/messaging/queries'
import { networkRepository } from '@/features/network/repository'
import { getNotificationChrome } from '@/features/notifications/queries'
import { organizationLinkRepository } from '@/features/profiles/organization-link-repository'
import { getProfilePortfolio } from '@/features/profiles/profile-portfolio-repository'
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
  const [notificationChrome, messagingUnreadCount, canAccessAdmin, profile, memberships, pendingConnectionRequestCount, portfolio] = await Promise.all([
    getNotificationChrome(),
    getUnreadMessageCount(),
    canAccessPlatformAdmin(user.id),
    getOwnProfile().catch(() => null),
    // Owners and administrators first. The menu still works (without the list) if this fails.
    organizationLinkRepository.listMemberOrganizations(user.id).catch(() => []),
    // The Network tab badge: the same count as the Requests tab on /network.
    networkRepository.countIncomingRequests(user.id).catch(() => 0),
    // Only used for the drawer's "Complete profile · n%" line; the drawer omits it if this fails.
    getProfilePortfolio(user.id).catch(() => null),
  ])
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
    notificationChrome,
    messagingUnreadCount,
    canAccessAdmin,
    viewer,
    organizations,
    organizationCount: memberships.length,
    pendingConnectionRequestCount,
  }
}

export type AppChromeData = Awaited<ReturnType<typeof getAppChromeData>>

/** Props for the desktop header, shared by the (app) and (public) layouts so they never drift. */
export function appHeaderProps(chrome: AppChromeData) {
  return {
    recentNotifications: chrome.notificationChrome.recent,
    unreadCount: chrome.notificationChrome.unreadCount,
    messagingUnreadCount: chrome.messagingUnreadCount,
    canAccessAdmin: chrome.canAccessAdmin,
    viewer: chrome.viewer,
    organizations: chrome.organizations,
    organizationCount: chrome.organizationCount,
  }
}

/** Props for the phone top bar (and its side drawer). */
export function mobileAppHeaderProps(chrome: AppChromeData) {
  return {
    messagingUnreadCount: chrome.messagingUnreadCount,
    canAccessAdmin: chrome.canAccessAdmin,
    viewer: chrome.viewer,
    organizations: chrome.organizations,
    organizationCount: chrome.organizationCount,
  }
}

/** Props for the phone bottom tabs. */
export function mobileNavProps(chrome: AppChromeData) {
  return {
    notificationUnreadCount: chrome.notificationChrome.unreadCount,
    pendingConnectionRequestCount: chrome.pendingConnectionRequestCount,
  }
}
