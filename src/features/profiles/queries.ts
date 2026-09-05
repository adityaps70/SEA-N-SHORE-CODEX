import {
  getAwsNetworkProfiles,
  getAwsOwnProfile,
  getAwsPublicProfileBySlug,
  getAwsPublicProfilesByIds,
} from './aws-queries'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getOnboardingProfileFromAurora, type OnboardingProfile } from './onboarding-repository'
import type { OwnProfile, PublicProfile } from './types'

export async function getPublicProfileBySlug(slug: string): Promise<PublicProfile | null> {
  return getAwsPublicProfileBySlug(slug)
}

export async function getOwnProfile(): Promise<OwnProfile | null> {
  return getAwsOwnProfile()
}

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
