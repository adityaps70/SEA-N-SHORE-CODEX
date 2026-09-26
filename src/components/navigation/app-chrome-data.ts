import { canAccessPlatformAdmin } from '@/features/admin/access'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'
import { getUnreadMessageCount } from '@/features/messaging/queries'
import { getNotificationChrome } from '@/features/notifications/queries'
import { getOwnProfile } from '@/features/profiles/queries'
import type { HeaderViewer } from './viewer-avatar'

/** Everything the signed-in header, mobile header and bottom bar need, loaded in parallel. */
export async function getAppChromeData(user: AwsVerifiedUser) {
  const [notificationChrome, messagingUnreadCount, canAccessAdmin, profile] = await Promise.all([
    getNotificationChrome(),
    getUnreadMessageCount(),
    canAccessPlatformAdmin(user.id),
    getOwnProfile().catch(() => null),
  ])
  const viewer: HeaderViewer = { name: profile?.fullName ?? user.email ?? 'Member', avatarUrl: profile?.avatarUrl ?? null }
  return { notificationChrome, messagingUnreadCount, canAccessAdmin, viewer }
}
