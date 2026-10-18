import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { getOwnProfile } from '@/features/profiles/queries'
import { canBeOpenToRecruiters, DEFAULT_PRIVACY_CHOICES, DEFAULT_PRIVACY_PREFERENCES, privacyPreferences } from '@/features/profiles/privacy-preferences'
import {
  CONNECTIONS_VISIBILITIES,
  CONNECTIONS_VISIBILITY_LABELS,
  MESSAGE_PERMISSIONS,
  MESSAGE_PERMISSION_LABELS,
} from '@/features/profiles/privacy-choices'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PrivacyChoice } from './privacy-choice'
import { PrivacyToggle } from './privacy-toggle'

export const metadata: Metadata = { title: 'Privacy · Settings' }
export const dynamic = 'force-dynamic'

/**
 * Settings → Privacy (round G): who can find you in suggestions and, if you choose, recruiters.
 * Round H (H2): who can message you and who can see your connections.
 * Round H (H5): whether search engines may list your public profile page (off by default).
 */
export default async function PrivacySettingsPage() {
  const user = await requireAwsUser()
  const [preferences, choices, profile] = await Promise.all([
    privacyPreferences.get(user.id).catch(() => DEFAULT_PRIVACY_PREFERENCES),
    privacyPreferences.getChoices(user.id).catch(() => DEFAULT_PRIVACY_CHOICES),
    getOwnProfile(),
  ])
  const offerOpenToWork = canBeOpenToRecruiters(profile?.persona)

  return (
    <div className="mx-auto w-full max-w-page-narrow space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Privacy" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Privacy</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Choose where Sea N Shore may suggest you, who can message you, who can see your connections and whether search engines may show your profile.</p>
      </header>
      <section aria-label="Suggestions" className="space-y-4 rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <PrivacyToggle
          setting="showInPeopleSuggestions"
          label="Show me in People you may know"
          description="Members who share your connections, ships, companies or institute may see you as a suggestion. Your profile stays visible either way."
          initiallyOn={preferences.showInPeopleSuggestions}
          onMessage="You can appear in People you may know."
          offMessage="You won’t be suggested to other members."
        />
        {offerOpenToWork ? (
          <div className="border-t border-mist-100 pt-4">
            <PrivacyToggle
              setting="openToRecruiters"
              label="Let recruiters find me as open to work"
              description="Recruiters can see you in “Suggested candidates” for jobs that match you and contact you through Sea N Shore messages. Your contact details are never shared."
              initiallyOn={preferences.openToRecruiters}
              onMessage="Recruiters can find you as open to work."
              offMessage="Recruiters won’t see you as open to work."
            />
          </div>
        ) : (
          // Round H (H2): the Settings card mentions recruiters, so explain who the switch is for.
          <p className="border-t border-mist-100 pt-4 text-sm leading-6 text-muted">
            <span className="block text-[15px] font-semibold text-navy-950">Let recruiters find me as open to work</span>
            Recruiters can find seafarers and shore professionals who are open to work. To use this, set your profile type to seafarer or shore professional on your <Link href="/profile" className="font-semibold text-ocean-700 hover:underline">profile</Link>.
          </p>
        )}
      </section>
      <section aria-label="Messages and connections" className="space-y-5 rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <PrivacyChoice
          setting="messagePermission"
          legend="Who can message me"
          description="Members you block can never message you, whatever you choose here."
          options={MESSAGE_PERMISSIONS.map((value) => ({ value, label: MESSAGE_PERMISSION_LABELS[value] }))}
          initialValue={choices.messagePermission}
          savedMessage={(value) => value === 'nobody' ? 'Nobody can message you now.' : `Saved: ${MESSAGE_PERMISSION_LABELS[value]}.`}
        />
        <div className="border-t border-mist-100 pt-4">
          <PrivacyChoice
            setting="connectionsVisibility"
            legend="Who can see my connections"
            description="Your connections, followers and following lists. Everyone can still see how many you have."
            options={CONNECTIONS_VISIBILITIES.map((value) => ({ value, label: CONNECTIONS_VISIBILITY_LABELS[value] }))}
            initialValue={choices.connectionsVisibility}
            savedMessage={(value) => `Saved: ${CONNECTIONS_VISIBILITY_LABELS[value]}.`}
          />
        </div>
      </section>
      {/* Round H (H5): opt-in for search engines; off keeps the profile page noindex and out of the sitemap. */}
      <section aria-label="Search engines" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <PrivacyToggle
          setting="allowSearchIndexing"
          label="Let search engines show my profile"
          description="Your public profile page can appear in Google and other search engines. Off: search engines are asked not to list it."
          initiallyOn={preferences.allowSearchIndexing}
          onMessage="Search engines may now show your profile."
          offMessage="Search engines are asked not to list your profile."
        />
      </section>
      <p className="text-sm leading-6 text-muted">
        How we use your data: <Link href="/privacy" className="font-semibold text-ocean-700 hover:underline">Privacy policy</Link>.
      </p>
    </div>
  )
}
