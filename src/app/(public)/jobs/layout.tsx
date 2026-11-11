import { MainLandmark } from '@/components/layout/main-landmark'
import { getChromeCountsForRequest } from '@/components/navigation/chrome-counts'
import { getVerifiedUser } from '@/features/auth/queries'
import { MessagingDock } from '@/features/messaging/components/messaging-dock'
import { LegacyOrganizationConversionBanner } from '@/features/organizations/components/legacy-conversion-banner'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'
import { SourceVisitBeacon } from '@/features/ranking/components/source-visit-beacon'

const MAIN_CLASS = 'mx-auto w-full max-w-page-wide px-4 py-4 md:py-6'

/**
 * Round H (H5): the jobs list and job pages are public, for visitors and search engines. The (public)
 * layout gives members the app header, phone bar and tabs, and visitors the public header. Around that,
 * members keep what the signed-in (app) shell adds: the same page width, the account conversion banner,
 * the messaging dock and the job-alert / digest visit count. Saved jobs, applications and alerts stay in
 * the (app) group.
 */
export default async function PublicJobsLayout({ children }: { children: React.ReactNode }) {
  const viewer = await getVerifiedUser()
  if (!viewer) return <MainLandmark className={MAIN_CLASS}>{children}</MainLandmark>

  const [messagingUnreadCount, legacyConversion] = await Promise.all([
    // Round DB: the (public) layout's chrome already read this count in this render; share it, don't re-query.
    getChromeCountsForRequest(viewer.id).then((counts) => counts.messagingUnreadCount).catch(() => 0),
    legacyOrganizationConversionRepository.getConversion(viewer.id).catch(() => null),
  ])
  return (
    <>
      {legacyConversion?.status === 'pending' ? <LegacyOrganizationConversionBanner /> : null}
      <MainLandmark className={MAIN_CLASS}>{children}</MainLandmark>
      <MessagingDock viewerId={viewer.id} initialUnreadCount={messagingUnreadCount} />
      <SourceVisitBeacon />
    </>
  )
}
