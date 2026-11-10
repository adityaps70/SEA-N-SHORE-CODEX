import { getVerifiedUser } from '@/features/auth/queries'
import { LegacyOrganizationConversionBanner } from '@/features/organizations/components/legacy-conversion-banner'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'
import { SourceVisitBeacon } from '@/features/ranking/components/source-visit-beacon'

const PAGE_CLASS = 'mx-auto w-full max-w-page-wide px-4 py-4 md:py-6'

/**
 * Round ARCH (Phase 2): the organization page moved from the signed-in (app) group to (public). The (public)
 * layout gives members the app header, phone bar, tabs and Messaging dock (MemberChrome) and visitors the
 * public header. Around that, members keep what the (app) shell added: the same page width, the account
 * conversion banner and the digest visit count. Visitors get the same width and nothing else.
 */
export default async function OrganizationPageLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getVerifiedUser()
  if (!viewer) return <div className={PAGE_CLASS}>{children}</div>

  const legacyConversion = await legacyOrganizationConversionRepository.getConversion(viewer.id).catch(() => null)
  return (
    <>
      {legacyConversion?.status === 'pending' ? <LegacyOrganizationConversionBanner /> : null}
      <div className={PAGE_CLASS}>{children}</div>
      <SourceVisitBeacon />
    </>
  )
}
