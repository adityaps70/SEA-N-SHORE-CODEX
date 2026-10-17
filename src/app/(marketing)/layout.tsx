import { fallbackAppChromeData, getAppChromeData } from '@/components/navigation/app-chrome-data'
import { MemberChrome } from '@/components/navigation/member-chrome'
import { PublicHeader } from '@/components/navigation/public-header'
import { SiteFooter } from '@/components/navigation/site-footer'
import { getVerifiedUser } from '@/features/auth/queries'
import { MarketingChrome } from './marketing-chrome'

async function resolveViewer() {
  // Fail open: when auth resolution is unavailable the page still renders for a signed-out
  // visitor (the same rule as the landing page, src/app/(marketing)/page.tsx).
  try {
    return await getVerifiedUser()
  } catch {
    return null
  }
}

/**
 * Round H (H6): signed-in members get the same app chrome on Pricing, About, Contact, Help, the
 * landing page and every other marketing page as in the app. Signed-out visitors keep the public
 * header and the site footer (the landing page draws its own, see MarketingChrome).
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const viewer = await resolveViewer()

  if (viewer) {
    // Counts and the profile are extras here: a marketing page never fails because of them.
    const chrome = await getAppChromeData(viewer).catch(() => fallbackAppChromeData(viewer))
    return (
      <MemberChrome viewerId={viewer.id} chrome={chrome}>
        {children}
      </MemberChrome>
    )
  }

  return (
    <MarketingChrome header={<PublicHeader />} footer={<SiteFooter signedIn={false} />}>
      {children}
    </MarketingChrome>
  )
}
