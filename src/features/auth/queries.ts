import { redirect } from 'next/navigation'
import { cache } from 'react'
import { getAwsVerification, getAwsVerifiedUser } from '@/features/auth/aws-queries'
import { getOnboardingProfileFromAurora } from '@/features/profiles/onboarding-repository'
import { SESSION_ENDED_PATH } from '@/features/account-security/paths'

export const getVerifiedUser = cache(getAwsVerifiedUser)

export async function requireUser() {
  const user = await getVerifiedUser()
  if (!user) {
    // Round H (H3): a device signed out from another device has its auth cookies cleared on the way to sign-in.
    redirect((await sessionWasSignedOut()) ? SESSION_ENDED_PATH : '/auth/sign-in')
  }
  return user
}

async function sessionWasSignedOut() {
  try {
    return (await getAwsVerification()).sessionRevoked
  } catch {
    return false
  }
}

export async function getOwnProfileOnboardingState(userId: string) {
  const user = await requireUser()
  if (user.id !== userId) throw new Error('Unable to load profile progress.')

  const profile = await getOnboardingProfileFromAurora(user.id)
  if (!profile) throw new Error('Unable to load profile progress.')
  return Boolean(profile.onboardingCompletedAt)
}

/**
 * Round I (I3): sign-in and sign-up send a member who is still signed in (their session was just renewed from the
 * 30-day refresh cookie by src/proxy.ts) on to the page they came for, instead of asking for the password again.
 * Not after a post-sign-in failure (`?error=`), which would loop back here.
 */
export async function continueIfSignedIn(params: { error?: string | string[] }) {
  if (params.error) return
  let signedIn = false
  try {
    signedIn = Boolean(await getVerifiedUser())
  } catch {
    signedIn = false
  }
  if (signedIn) redirect('/auth/post-sign-in')
}
