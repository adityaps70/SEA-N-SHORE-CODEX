import { AppFooter } from '@/components/navigation/app-footer'
import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireUser } from '@/features/auth/queries'
import { MessagingDock } from '@/features/messaging/components/messaging-dock'
import { LegacyOrganizationConversionBanner } from '@/features/organizations/components/legacy-conversion-banner'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'
import { getUnreadMessageCount } from '@/features/messaging/queries'
import { getNotificationChrome } from '@/features/notifications/queries'
import { getOwnProfile } from '@/features/profiles/queries'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [notificationChrome, messagingUnreadCount, canAccessAdmin, legacyConversion, profile] = await Promise.all([
    getNotificationChrome(),
    getUnreadMessageCount(),
    canAccessPlatformAdmin(user.id),
    legacyOrganizationConversionRepository.getConversion(user.id).catch(() => null),
    getOwnProfile().catch(() => null),
  ])
  const viewer = { name: profile?.fullName ?? user.email ?? 'Member', avatarUrl: profile?.avatarUrl ?? null }

  return (
    <MessagingRealtimeProvider viewerProfileId={user.id}>
      <div className="min-h-screen bg-mist-50 pb-20 md:pb-0 md:pt-18">
        {legacyConversion?.status === 'pending' ? <LegacyOrganizationConversionBanner /> : null}
        <AppHeader
          recentNotifications={notificationChrome.recent}
          unreadCount={notificationChrome.unreadCount}
          messagingUnreadCount={messagingUnreadCount}
          canAccessAdmin={canAccessAdmin}
          viewer={viewer}
        />
        <MobileAppHeader
          unreadCount={notificationChrome.unreadCount}
          messagingUnreadCount={messagingUnreadCount}
          viewer={viewer}
        />
        <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6">
          {children}
        </main>
        <AppFooter />
        <MessagingDock viewerId={user.id} initialUnreadCount={messagingUnreadCount} />
        <MobileNav canAccessAdmin={canAccessAdmin} />
      </div>
    </MessagingRealtimeProvider>
  )
}
