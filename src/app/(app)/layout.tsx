import { getAppChromeData } from '@/components/navigation/app-chrome-data'
import { MemberChrome } from '@/components/navigation/member-chrome'
import { SourceVisitBeacon } from '@/features/ranking/components/source-visit-beacon'
import { requireUser } from '@/features/auth/queries'
import { LegacyOrganizationConversionBanner } from '@/features/organizations/components/legacy-conversion-banner'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'

/**
 * Signed-in app shell. Round H (H6): the header, phone bars, footer and Messaging dock come from
 * MemberChrome, shared with the (public) and (marketing) layouts so members see one layout.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const [chrome, legacyConversion] = await Promise.all([
    getAppChromeData(user),
    legacyOrganizationConversionRepository.getConversion(user.id).catch(() => null),
  ])

  return (
    <MemberChrome
      viewerId={user.id}
      chrome={chrome}
      banner={legacyConversion?.status === 'pending' ? <LegacyOrganizationConversionBanner /> : null}
    >
      <main id="main-content" className="mx-auto w-full max-w-page-wide px-4 py-4 md:py-6">
        {children}
      </main>
      <SourceVisitBeacon />
    </MemberChrome>
  )
}
