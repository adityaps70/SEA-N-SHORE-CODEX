import { redirect } from 'next/navigation'
import { cache } from 'react'
import { createServerSupabaseClient } from '@/lib/supabase/server'

export const getVerifiedUser = cache(async () => {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  return error ? null : data.user
})

export async function requireUser() {
  const user = await getVerifiedUser()
  if (!user) redirect('/auth/sign-in')
  return user
}

export async function getOwnProfileOnboardingState(userId: string) {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('onboarding_completed_at')
    .eq('id', userId)
    .maybeSingle()

  if (error || !data) throw new Error('Unable to load profile progress.')
  return Boolean(data.onboarding_completed_at)
}
