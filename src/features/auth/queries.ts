import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getAwsVerifiedUser } from '@/features/auth/aws-queries'
import { getOnboardingProfileFromAurora } from '@/features/profiles/onboarding-repository'

export const getVerifiedUser = cache(getAwsVerifiedUser)

export async function requireUser() {
  const user = await getVerifiedUser()
  if (!user) redirect('/auth/sign-in')
  return user
}

export async function getOwnProfileOnboardingState(userId: string) {
  const user = await requireUser()
  if (user.id !== userId) throw new Error('Unable to load profile progress.')

  const profile = await getOnboardingProfileFromAurora(user.id)
  if (!profile) throw new Error('Unable to load profile progress.')
  return Boolean(profile.onboardingCompletedAt)
}
