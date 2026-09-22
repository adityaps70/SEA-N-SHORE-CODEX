import { AppFooter } from '@/components/navigation/app-footer'
import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireUser } from '@/features/auth/queries'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { MessagingDock } from '@/features/messaging/components/messaging-dock'
import { getUnreadMessageCount } from '@/features/messaging/queries'
import { getNotificationChrome } from '@/features/notifications/queries'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [notificationChrome, messagingUnreadCount, authorizedCompany, canAccessAdmin] = await Promise.all([
    getNotificationChrome(),
    getUnreadMessageCount(),
    hiringRepository.getAuthorizedCompany(user.id).catch(() => null),
    canAccessPlatformAdmin(user.id),
  ])

  return (
    <MessagingRealtimeProvider viewerProfileId={user.id}>
      <div className="min-h-screen bg-mist-50 pb-20 md:pb-0 md:pt-18">
        <AppHeader
          recentNotifications={notificationChrome.recent}
          unreadCount={notificationChrome.unreadCount}
          messagingUnreadCount={messagingUnreadCount}
          canStartHiring={Boolean(authorizedCompany)}
          canAccessAdmin={canAccessAdmin}
        />
        <MobileAppHeader
          unreadCount={notificationChrome.unreadCount}
          messagingUnreadCount={messagingUnreadCount}
          canStartHiring={Boolean(authorizedCompany)}
          canAccessAdmin={canAccessAdmin}
        />
        <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6">
          {children}
        </main>
        <AppFooter />
        <MessagingDock viewerId={user.id} initialUnreadCount={messagingUnreadCount} />
        <MobileNav />
      </div>
    </MessagingRealtimeProvider>
  )
}
