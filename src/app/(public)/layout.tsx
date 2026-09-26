import { AppFooter } from '@/components/navigation/app-footer'
import { getAppChromeData } from '@/components/navigation/app-chrome-data'
import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { PublicFooter } from '@/components/navigation/public-footer'
import { PublicHeader } from '@/components/navigation/public-header'
import { getVerifiedUser } from '@/features/auth/queries'

export default async function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getVerifiedUser()

  // Signed-in members keep the full app navigation, search, messages and
  // notifications while viewing someone else's profile or a certificate.
  if (viewer) {
    const chrome = await getAppChromeData(viewer)
    return (
      <div className="min-h-screen bg-mist-50 pb-20 md:pb-0 md:pt-18">
        <AppHeader
          recentNotifications={chrome.notificationChrome.recent}
          unreadCount={chrome.notificationChrome.unreadCount}
          messagingUnreadCount={chrome.messagingUnreadCount}
          canAccessAdmin={chrome.canAccessAdmin}
          viewer={chrome.viewer}
        />
        <MobileAppHeader
          unreadCount={chrome.notificationChrome.unreadCount}
          messagingUnreadCount={chrome.messagingUnreadCount}
          viewer={chrome.viewer}
        />
        {children}
        <AppFooter />
        <MobileNav canAccessAdmin={chrome.canAccessAdmin} />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-mist-50">
      <PublicHeader />
      {children}
      <PublicFooter />
    </div>
  )
}
