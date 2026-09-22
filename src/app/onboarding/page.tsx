import { redirect } from 'next/navigation'
import { Wordmark } from '@/components/brand/wordmark'
import { Card } from '@/components/ui/card'
import { OnboardingForm } from '@/features/profiles/components/onboarding-form'
import { getOwnOnboardingProfile } from '@/features/profiles/queries'

export default async function OnboardingPage() {
  const profile = await getOwnOnboardingProfile()

  if (profile.onboardingCompletedAt) redirect('/home')

  return (
    <main
      id="main-content"
      className="min-h-screen bg-[linear-gradient(180deg,var(--mist-50)_0%,white_42%,var(--mist-50)_100%)] px-4 py-4 sm:px-6 sm:py-6"
    >
      <div className="mx-auto max-w-5xl">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-mist-100">
          <Wordmark compact />
          <span className="rounded-full border border-mist-100 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-ocean-700 shadow-sm">
            Professional onboarding
          </span>
        </div>

        <header className="max-w-3xl py-8 sm:py-10">
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

        <Card className="rounded-[1.75rem] border border-mist-100 p-5 shadow-[0_18px_60px_rgba(15,38,58,0.08)] sm:p-7 lg:p-8">
          <div className="mb-7 flex flex-wrap items-center justify-between gap-3 border-b border-mist-100 pb-5">
            <div>
              <p className="text-sm font-semibold text-navy-950">Build your maritime presence</p>
              <p className="mt-1 text-sm text-muted">Choose your identity first. You can add more depth after joining.</p>
            </div>
            <span className="rounded-full bg-mist-50 px-3 py-1.5 text-xs font-semibold text-muted">
              Step 1 of 2
            </span>
          </div>
          <OnboardingForm initialFullName={profile.fullName} />
        </Card>

        <p className="px-2 py-6 text-center text-xs leading-5 text-muted">
          Your profile can evolve with your career. Start with the identity that best represents you today.
        </p>
      </div>
    </main>
  )
}
