import { cache } from 'react'
import {
  getAwsNetworkProfiles,
  getAwsOwnProfile,
  getAwsPublicProfileBySlug,
  getAwsPublicProfilesByIds,
} from './aws-queries'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getOnboardingProfileFromAurora, type OnboardingProfile } from './onboarding-repository'
import type { OwnProfile, PublicProfile } from './types'

export const getPublicProfileBySlug = cache(async (slug: string): Promise<PublicProfile | null> => {
  return getAwsPublicProfileBySlug(slug)
})

// Request-scoped cache: the app shell (header avatar) and the page both need the
// viewer's profile, so one Aurora query serves every caller in the same render.
export const getOwnProfile = cache(async (): Promise<OwnProfile | null> => {
  return getAwsOwnProfile()
})

export async function getNetworkProfiles(limit = 18): Promise<PublicProfile[]> {
  return getAwsNetworkProfiles(limit)
}

export async function getPublicProfilesByIds(ids: string[]): Promise<PublicProfile[]> {
  return getAwsPublicProfilesByIds(ids)
}

export async function getOwnOnboardingProfile(): Promise<OnboardingProfile> {
  const user = await requireAwsUser()
  const profile = await getOnboardingProfileFromAurora(user.id)
  if (!profile) throw new Error('Unable to load your profile.')
  return profile
}
