import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { Wordmark } from '@/components/brand/wordmark'
import { LogOut } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { signOutToSignUp } from '@/features/auth/actions'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OnboardingForm } from '@/features/profiles/components/onboarding-form'
import { getOwnOnboardingSetup, getOwnRegisteredOrganization } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'Set up your profile' }

export default async function OnboardingPage({
  searchParams,
}: {
  /** `registered`: an organization the member just registered from the organization picker. */
  searchParams?: Promise<{ registered?: string | string[] }>
} = {}) {
  const profile = await getOwnOnboardingSetup()

  if (profile.onboardingCompletedAt) redirect('/home')
  const registeredOrganization = await getOwnRegisteredOrganization((await searchParams)?.registered)
  // Cached per request: the same verified user getOwnOnboardingSetup already loaded.
  const { email } = await requireAwsUser()

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[linear-gradient(180deg,var(--mist-50)_0%,white_42%,var(--mist-50)_100%)] px-4 py-4 sm:px-6 sm:py-6 max-md:bg-white max-md:py-2"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-mist-100 max-md:min-h-14">
          <Wordmark compact />
          <div className="flex min-w-0 items-center gap-3">
            <span className="rounded-full border border-mist-100 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-ocean-700 shadow-sm max-lg:hidden">
              Professional onboarding
            </span>
            {/* Round 10: signed up with the wrong email? Sign out and start again from sign-up. */}
            <form action={signOutToSignUp} className="flex min-w-0 items-center gap-2">
              {email ? (
                <span className="truncate text-xs text-muted max-sm:hidden" title={email}>
                  Signed in as <span className="font-semibold text-navy-900">{email}</span>
                </span>
              ) : null}
              <button
                type="submit"
                className="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-mist-200 bg-white px-3 text-xs font-semibold text-navy-900 shadow-sm transition hover:border-ocean-300 hover:text-ocean-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
              >
                <LogOut aria-hidden="true" className="size-3.5" />
                <span className="sm:hidden">Sign out</span>
                <span className="max-sm:hidden">Not you? Use a different email</span>
              </button>
            </form>
          </div>
        </div>

        {/* Phones skip the intro: the form's own progress bar and step titles replace it. */}
        <header className="max-w-3xl py-8 sm:py-10 max-md:hidden">
          <div className="inline-flex items-center rounded-full bg-ocean-50 px-3 py-1.5 text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">
            Your maritime identity
          </div>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-[-.045em] text-navy-950 sm:text-5xl">
            Set your course in the global shipping community.
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-7 text-muted sm:text-lg">
            Build your maritime presence around the work you do, the experience you bring, and where you want to go next.
          </p>
        </header>

        <Card className="rounded-[1.75rem] border border-mist-100 p-5 shadow-[0_18px_60px_rgba(15,38,58,0.08)] sm:p-7 lg:p-8 max-md:mt-3 max-md:rounded-none max-md:border-0 max-md:px-0 max-md:py-2 max-md:shadow-none">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 pb-5 max-md:hidden">
            <div>
              <p className="text-sm font-semibold text-navy-950">Build your maritime presence</p>
              <p className="mt-1 text-sm text-muted">Choose your identity first. You can add more depth after joining.</p>
            </div>
            <span className="rounded-full bg-mist-50 px-3 py-1.5 text-xs font-semibold text-muted">
              Step 1 of 2
            </span>
          </div>
          <OnboardingForm
            initialFullName={profile.fullName}
            initialValues={profile.initialValues}
            suggestedUsername={profile.suggestedUsername}
            profileId={profile.profileId}
            initialDgProfile={profile.dgProfile}
            registeredOrganization={registeredOrganization}
          />
        </Card>

        <p className="px-2 py-6 text-center text-xs leading-5 text-muted">
          Your profile can evolve with your career. Start with the identity that best represents you today.
        </p>
      </div>
    </main>
  )
}
