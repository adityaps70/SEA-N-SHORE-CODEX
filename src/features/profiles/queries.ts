import { cache } from 'react'
import {
  getAwsNetworkProfiles,
  getAwsOwnProfile,
  getAwsPublicProfileBySlug,
  getAwsPublicProfilesByIds,
} from './aws-queries'
import { requireAwsUser } from '@/features/auth/aws-queries'
import type { PickerOrganization } from './components/organization-picker'
import { getOnboardingProfileFromAurora, type OnboardingProfile } from './onboarding-repository'
import { organizationLinkRepository, type ProfileOrganization } from './organization-link-repository'
import type { ProfileDocumentSummary } from './profile-document-policy'
import { getOwnDgProfileDocument } from './profile-document-service'
import type { OwnProfile, PublicProfile } from './types'
import { isValidUsername } from './username'
import { suggestAvailableUsernameFromAurora } from './username-availability'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export type OnboardingSetup = OnboardingProfile & {
  profileId: string
  suggestedUsername: string
  dgProfile: ProfileDocumentSummary | null
}

/**
 * Everything the onboarding screen needs, including a ready-to-use username
 * so a first-time member never starts from an empty or invalid handle. Both
 * extras degrade gracefully: the submit step generates a username itself and
 * the DG profile upload works without an initial document.
 */
export async function getOwnOnboardingSetup(): Promise<OnboardingSetup> {
  const user = await requireAwsUser()
  const profile = await getOnboardingProfileFromAurora(user.id)
  if (!profile) throw new Error('Unable to load your profile.')
  if (profile.onboardingCompletedAt) {
    return { ...profile, profileId: user.id, suggestedUsername: profile.slug ?? '', dgProfile: null }
  }

  const [suggestedUsername, dgProfile] = await Promise.all([
    profile.slug && isValidUsername(profile.slug)
      ? Promise.resolve(profile.slug)
      : suggestAvailableUsernameFromAurora(user.id, { fullName: profile.fullName, email: user.email }).catch(() => ''),
    getOwnDgProfileDocument(user.id).catch(() => null),
  ])

  return { ...profile, profileId: user.id, suggestedUsername, dgProfile }
}

/**
 * The organization a member just registered from the organization picker
 * (`?registered=<id>` on their return), so the picker can link it. Only the
 * member's own organization that Sea N Shore is still verifying, or a listed
 * one, is returned; anything else is ignored.
 */
export async function getOwnRegisteredOrganization(value: unknown): Promise<PickerOrganization | null> {
  const raw = Array.isArray(value) ? value[0] : value
  if (typeof raw !== 'string' || !UUID_PATTERN.test(raw)) return null
  try {
    const user = await requireAwsUser()
    const pending = await organizationLinkRepository.getOwnPendingOrganization(user.id, raw)
    if (pending) return { id: pending.id, name: pending.name, logoUrl: pending.logoUrl, verified: pending.verified, pending: true }
    const listed = await organizationLinkRepository.getListableOrganization(raw)
    return listed ? { id: listed.id, name: listed.name, logoUrl: listed.logoUrl, verified: listed.verified, unclaimed: listed.unclaimed } : null
  } catch {
    return null
  }
}

/** Organizations shown in the Organizations section of a profile; empty when they cannot be loaded. */
export async function getProfileOrganizations(profileId: string): Promise<ProfileOrganization[]> {
  try {
    return await organizationLinkRepository.listProfileOrganizations(profileId)
  } catch {
    return []
  }
}
