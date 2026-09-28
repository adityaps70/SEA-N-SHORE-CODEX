import { canAccessPlatformAdmin } from '@/features/admin/access'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import { getUnreadMessageCount } from '@/features/messaging/queries'
import { getNotificationChrome } from '@/features/notifications/queries'
import { organizationLinkRepository } from '@/features/profiles/organization-link-repository'
import { getOwnProfile } from '@/features/profiles/queries'
import type { HeaderOrganization } from './app-header'
import type { HeaderViewer } from './viewer-avatar'

/** The account menu lists a few organizations; the rest are on /organizations. */
export const HEADER_ORGANIZATION_LIMIT = 3

/** Everything the signed-in header, mobile header and bottom bar need, loaded in parallel. */
export async function getAppChromeData(user: AwsVerifiedUser) {
  const [notificationChrome, messagingUnreadCount, canAccessAdmin, profile, memberships] = await Promise.all([
    getNotificationChrome(),
    getUnreadMessageCount(),
    canAccessPlatformAdmin(user.id),
    getOwnProfile().catch(() => null),
    // Owners and administrators first. The menu still works (without the list) if this fails.
    organizationLinkRepository.listMemberOrganizations(user.id).catch(() => []),
  ])
  const viewer: HeaderViewer = { name: profile?.fullName ?? user.email ?? 'Member', avatarUrl: profile?.avatarUrl ?? null }
  const organizations: HeaderOrganization[] = memberships.slice(0, HEADER_ORGANIZATION_LIMIT).map((organization) => ({
    id: organization.id,
    slug: organization.slug,
    name: organization.name,
    logoUrl: organization.logoUrl,
    canManage: organization.role !== 'member',
  }))
  return { notificationChrome, messagingUnreadCount, canAccessAdmin, viewer, organizations, organizationCount: memberships.length }
}
