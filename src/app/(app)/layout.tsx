import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { requireUser } from '@/features/auth/queries'
import { hiringRepository } from '@/features/jobs/hiring-repository'
import { getNotificationChrome } from '@/features/notifications/queries'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [notificationChrome, authorizedCompany] = await Promise.all([
    getNotificationChrome(),
    hiringRepository.getAuthorizedCompany(user.id).catch(() => null),
  ])

  return (
    <div className="min-h-screen bg-mist-50 pb-20 md:pb-0 md:pt-18">
      <AppHeader
        recentNotifications={notificationChrome.recent}
        unreadCount={notificationChrome.unreadCount}
        canStartHiring={Boolean(authorizedCompany)}
      />
      <MobileAppHeader
        unreadCount={notificationChrome.unreadCount}
        canStartHiring={Boolean(authorizedCompany)}
      />
      <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-6">
        {children}
      </main>
      <MobileNav />
    </div>
  )
}
