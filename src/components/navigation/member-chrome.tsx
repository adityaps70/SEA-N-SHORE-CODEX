import type { ReactNode } from 'react'
import { MainLandmark, SkipLink } from '@/components/layout/main-landmark'
import { MessagingDock } from '@/features/messaging/components/messaging-dock'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'
import { appHeaderProps, mobileAppHeaderProps, mobileNavProps, type AppChromeData } from './app-chrome-data'
import { AppHeader } from './app-header'
import { MobileAppHeader } from './mobile-app-header'
import { MobileNav } from './mobile-nav'
import { SiteFooter } from './site-footer'

/**
 * Round H (H6): the one signed-in shell. The (app), (public) and (marketing) layouts all use it,
 * so members see the same header, phone top bar, bottom tabs, footer and Messaging dock on every
 * page, Pricing, About, Contact, Help and the landing page included.
 *
 * Phones: sticky top bar + side drawer (MobileAppHeader) and the bottom tabs (MobileNav); the
 * bottom padding clears the tabs and is dropped on full-screen routes, where the tab bar marks
 * itself `data-phone-tabbar="off"`. md and wider: the fixed AppHeader.
 *
 * Round H (H8): "Skip to content" is the first focusable element, and `children` sit in the page's one
 * <main id="main-content"> (MainLandmark); a page that draws its own MainLandmark renders a <div> inside it.
 */
export function MemberChrome({ viewerId, chrome, banner, children }: {
  viewerId: string
  chrome: AppChromeData
  /** Shown above the header (the (app) layout's legacy-organization banner). */
  banner?: ReactNode
  children: ReactNode
}) {
  return (
    // One realtime socket for every signed-in page, so moving between Home, Learn, a profile and
    // Pricing keeps the same connection.
    <MessagingRealtimeProvider viewerProfileId={viewerId}>
      <div data-app-shell="" className="group/shell min-h-screen bg-mist-50 pb-[calc(4.5rem+env(safe-area-inset-bottom))] has-[[data-phone-tabbar=off]]:pb-0 md:pb-0 md:pt-18">
        <SkipLink />
        {banner}
        <AppHeader {...appHeaderProps(chrome)} />
        <MobileAppHeader {...mobileAppHeaderProps(chrome)} />
        <MainLandmark>{children}</MainLandmark>
        <SiteFooter signedIn />
        {/* After the footer on purpose: the dock leaves an in-flow spacer the height of its bar at
            the end of the page, so the bar never covers the footer's last line. */}
        <MessagingDock viewerId={viewerId} initialUnreadCount={chrome.messagingUnreadCount} />
        <MobileNav {...mobileNavProps(chrome)} />
      </div>
    </MessagingRealtimeProvider>
  )
}
