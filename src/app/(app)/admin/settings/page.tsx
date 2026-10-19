import type { Metadata } from 'next'
import { AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { AboutContentForm } from '@/features/site-settings/components/about-content-form'
import { GrievanceOfficerForm } from '@/features/site-settings/components/grievance-officer-form'
import { SocialHandlesForm } from '@/features/site-settings/components/social-handles-form'
import { getMemberNumbers } from '@/features/site-settings/queries'
import { siteSettingsRepository } from '@/features/site-settings/repository'
import { signedAboutImageUrls } from '@/features/site-settings/images'

export const metadata: Metadata = { title: 'Site settings · Admin' }
export const dynamic = 'force-dynamic'

const PAGE_WIDTH = 'max-w-4xl' // Round H (H6) width token: switch to max-w-page-narrow when the tokens land.

/**
 * Round H (H7): Admin › Site settings. The Grievance Officer on the Contact page and the About page
 * sections (founders, team, partners, member numbers). Each save is validated and audited. Reading fails
 * loudly here (unlike the public pages) so an administrator never overwrites settings they could not see.
 */
export default async function AdminSiteSettingsPage() {
  const [officer, about, socials] = await Promise.all([
    siteSettingsRepository.get('grievance_officer').catch(() => null),
    siteSettingsRepository.get('about_page').catch(() => null),
    siteSettingsRepository.get('social_handles').catch(() => null),
  ])

  if (!officer || !about || !socials) {
    return (
      <div className={`w-full ${PAGE_WIDTH} space-y-5`}>
        <AdminPageHeader title="Site settings" />
        <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          The settings could not be loaded, so nothing can be edited right now. Is migration 0089 applied? Refresh the page in a minute.
        </p>
      </div>
    )
  }

  const [imageUrls, counts] = await Promise.all([
    signedAboutImageUrls(about),
    getMemberNumbers({ enabled: true, members: true, organizations: true, courses: true }).catch(() => []),
  ])
  const liveCount = (key: 'members' | 'organizations' | 'courses') => counts.find((entry) => entry.key === key)?.value ?? 0

  return (
    <div className={`w-full ${PAGE_WIDTH} space-y-5`}>
      <AdminPageHeader
        title="Site settings"
        description="Content the owner fills in for the public pages. Empty sections stay hidden; nothing here is ever made up by the site."
      />
      <AdminPanel className="p-4 sm:p-5">
        <h3 className="text-base font-semibold text-navy-950">Grievance Officer (Contact page)</h3>
        <p className="mt-1 text-sm text-muted">
          Until a name and email are saved, the Contact page says a Grievance Officer is being appointed and gives the support email.
        </p>
        <div className="mt-4">
          <GrievanceOfficerForm initial={officer} />
        </div>
      </AdminPanel>
      <AdminPanel className="p-4 sm:p-5">
        <h3 className="text-base font-semibold text-navy-950">About page</h3>
        <p className="mt-1 text-sm text-muted">Founders, team, partner logos and member numbers. A section with nothing in it is left out of the About page.</p>
        <div className="mt-4">
          <AboutContentForm
            initial={about}
            imageUrls={imageUrls}
            liveCounts={{ members: liveCount('members'), organizations: liveCount('organizations'), courses: liveCount('courses') }}
          />
        </div>
      </AdminPanel>
      <AdminPanel className="p-4 sm:p-5">
        <h3 className="text-base font-semibold text-navy-950">Social handles (job share images)</h3>
        <p className="mt-1 text-sm text-muted">Shown in the footer of the images posters make with Share job. The partner strip on those images uses the About page partner logos.</p>
        <div className="mt-4">
          <SocialHandlesForm initial={socials} />
        </div>
      </AdminPanel>
    </div>
  )
}
