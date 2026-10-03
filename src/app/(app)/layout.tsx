import { AppFooter } from '@/components/navigation/app-footer'
import { appHeaderProps, getAppChromeData, mobileAppHeaderProps, mobileNavProps } from '@/components/navigation/app-chrome-data'
import { AppHeader } from '@/components/navigation/app-header'
import { MobileAppHeader } from '@/components/navigation/mobile-app-header'
import { MobileNav } from '@/components/navigation/mobile-nav'
import { requireUser } from '@/features/auth/queries'
import { MessagingDock } from '@/features/messaging/components/messaging-dock'
import { LegacyOrganizationConversionBanner } from '@/features/organizations/components/legacy-conversion-banner'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'

/**
 * Signed-in app shell. Phones: sticky top bar + side drawer (MobileAppHeader) and the bottom
 * tabs (MobileNav); the bottom padding clears the tabs and is dropped on full-screen routes,
 * where the tab bar marks itself `data-phone-tabbar="off"`. md and wider: the fixed AppHeader.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [chrome, legacyConversion] = await Promise.all([
    getAppChromeData(user),
    legacyOrganizationConversionRepository.getConversion(user.id).catch(() => null),
  ])

  return (
    <MessagingRealtimeProvider viewerProfileId={user.id}>
      <div className="group/shell min-h-screen bg-mist-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))] has-[[data-phone-tabbar=off]]:pb-0 md:pb-0 md:pt-18">
        {legacyConversion?.status === 'pending' ? <LegacyOrganizationConversionBanner /> : null}
        <AppHeader {...appHeaderProps(chrome)} />
        <MobileAppHeader {...mobileAppHeaderProps(chrome)} />
        <main id="main-content" className="mx-auto w-full max-w-7xl px-4 py-4 md:py-6">
          {children}
        </main>
        <AppFooter />
        <MessagingDock viewerId={user.id} initialUnreadCount={chrome.messagingUnreadCount} />
        <MobileNav {...mobileNavProps(chrome)} />
      </div>
    </MessagingRealtimeProvider>
  )
}
