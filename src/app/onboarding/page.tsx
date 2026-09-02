import { redirect } from 'next/navigation'
import { RouteLine } from '@/components/brand/route-line'
import { Wordmark } from '@/components/brand/wordmark'
import { Card } from '@/components/ui/card'
import { requireUser } from '@/features/auth/queries'
import { OnboardingForm } from '@/features/profiles/components/onboarding-form'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export default async function OnboardingPage() {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('full_name, onboarding_completed_at')
    .eq('id', user.id)
    .maybeSingle()

  if (error || !profile) throw new Error('Unable to load your profile.')
  if (profile.onboarding_completed_at) redirect('/home')

  return (
    <main id="main-content" className="min-h-screen bg-mist-50 px-4 py-6 sm:py-10">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between">
          <Wordmark />
          <span className="text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">Professional onboarding</span>
        </div>
        <RouteLine className="mt-6" />
        <header className="max-w-3xl py-10 sm:py-14">
          <p className="text-sm font-semibold uppercase tracking-[.16em] text-ocean-700">Your maritime identity</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-.045em] text-navy-950 sm:text-6xl">Set your course in the global shipping community.</h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-muted sm:text-lg">Tell people where you have been, what you know, and where you want to go next.</p>
        </header>
        <Card className="border border-mist-100 p-5 sm:p-8 lg:p-10">
          <OnboardingForm initialFullName={profile.full_name} />
        </Card>
      </div>
    </main>
  )
}
