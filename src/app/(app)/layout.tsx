import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { requireUser } from '@/features/auth/queries'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { getUnreadConversationCount } from '@/features/messaging/queries'
import { getNotificationChrome } from '@/features/notifications/queries'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [notificationChrome, messagingUnreadCount, authorizedCompany] = await Promise.all([
    getNotificationChrome(),
    getUnreadConversationCount(),
    hiringRepository.getAuthorizedCompany(user.id).catch(() => null),
  ])

  return (
    <div className="min-h-screen bg-mist-50 pb-20 md:pb-0 md:pt-18">
      <AppHeader
        recentNotifications={notificationChrome.recent}
        unreadCount={notificationChrome.unreadCount}
        messagingUnreadCount={messagingUnreadCount}
        canStartHiring={Boolean(authorizedCompany)}
      />
      <MobileAppHeader
        unreadCount={notificationChrome.unreadCount}
        messagingUnreadCount={messagingUnreadCount}
        canStartHiring={Boolean(authorizedCompany)}
      />
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6">
        {children}
      </main>
      <MobileNav />
    </div>
  )
}
