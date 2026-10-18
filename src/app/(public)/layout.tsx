import { getAppChromeData } from '@/components/navigation/app-chrome-data'
import { MainLandmark, SkipLink } from '@/components/layout/main-landmark'
import { MemberChrome } from '@/components/navigation/member-chrome'
import { PublicHeader } from '@/components/navigation/public-header'
import { SiteFooter } from '@/components/navigation/site-footer'
import { getVerifiedUser } from '@/features/auth/queries'

export default async function PublicProfileLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getVerifiedUser()

  // Signed-in members keep the full app navigation, search, messages, notifications and their
  // organizations (account menu and phone drawer) while viewing a profile or a certificate.
  // Round H (H6): the same MemberChrome as the (app) layout (header, footer, Messaging dock and the
  // realtime provider that shares one socket with it), so the shells never drift.
  if (viewer) {
    const chrome = await getAppChromeData(viewer)
    return (
      <MemberChrome viewerId={viewer.id} chrome={chrome}>
        {children}
      </MemberChrome>
    )
  }

  // `group/shell` lets the site footer hide where a right rail shows its own footer.
  return (
    <div className="group/shell min-h-screen bg-mist-50">
      {/* Round H (H8): a skip link and the page's one main landmark, as in the member shell. */}
      <SkipLink />
      <PublicHeader />
      <MainLandmark>{children}</MainLandmark>
      <SiteFooter signedIn={false} />
    </div>
  )
}
