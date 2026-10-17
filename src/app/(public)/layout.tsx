import { AppFooter } from '@/components/navigation/app-footer'
import { appHeaderProps, getAppChromeData, mobileAppHeaderProps, mobileNavProps } from '@/components/navigation/app-chrome-data'
import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { PublicFooter } from '@/components/navigation/public-footer'
import { PublicHeader } from '@/components/navigation/public-header'
import { getVerifiedUser } from '@/features/auth/queries'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'

export default async function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getVerifiedUser()

  // Signed-in members keep the full app navigation, search, messages, notifications and their
  // organizations (account menu and phone drawer) while viewing a profile or a certificate.
  // The same chrome data and props as the (app) layout, so the two shells never drift.
  // Round H (H1): the realtime provider shares the (app) layout's socket, so moving between Home,
  // Learn and a profile keeps one connection.
  if (viewer) {
    const chrome = await getAppChromeData(viewer)
    return (
      <MessagingRealtimeProvider viewerProfileId={viewer.id}>
        <div className="group/shell min-h-screen bg-mist-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))] has-[[data-phone-tabbar=off]]:pb-0 md:pb-0 md:pt-18">
          <AppHeader {...appHeaderProps(chrome)} />
          <MobileAppHeader {...mobileAppHeaderProps(chrome)} />
          {children}
          <AppFooter />
          <MobileNav {...mobileNavProps(chrome)} />
        </div>
      </MessagingRealtimeProvider>
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
