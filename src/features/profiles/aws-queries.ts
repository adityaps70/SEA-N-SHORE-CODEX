import {
  getAwsVerifiedUser,
  requireAwsUser,
  type AwsVerifiedUser,
} from '@/features/auth/aws-queries'
import { createMediaImageSrc } from '@/lib/images/media-image-src'
import { isSyntheticDiscoveryText } from '@/lib/public-discovery'
import { createProfileMediaRepository, profileMediaRepository } from './profile-media-repository'
import { DECLINED_REQUEST_SUGGESTION_WINDOW, RECOMMENDATION_WEIGHTS } from '@/features/network/recommendations'
import { createProfileRepository } from './repository'
import { createClearableCache } from '@/lib/cache/cache-clear'
import { cacheClearHub } from '@/lib/cache/runtime'
import type { PublicProfile } from './types'

type GetVerifiedUser = () => Promise<AwsVerifiedUser | null>
type RequireUser = () => Promise<AwsVerifiedUser>
type ProfileRepository = ReturnType<typeof createProfileRepository>
type ProfileMediaRepository = ReturnType<typeof createProfileMediaRepository>

export function createAwsProfileQueries(input: {
  getVerifiedUser: GetVerifiedUser
  requireUser: RequireUser
  repository: ProfileRepository
  mediaRepository?: ProfileMediaRepository
  createReadUrl?: (key: string) => Promise<string>
}) {
  const mediaRepository = input.mediaRepository ?? profileMediaRepository
  const createReadUrl = input.createReadUrl ?? createMediaImageSrc

  /** `avatarOnly`: suggestion cards show no cover, so only the avatar is signed. */
  async function hydrateProfiles<T extends PublicProfile>(profiles: T[], options: { avatarOnly?: boolean } = {}): Promise<T[]> {
    if (!profiles.length) return profiles
    // Round DB: the profile select already reads avatar_path and cover_path from the same row, so the separate media
    // lookup only runs for a profile that arrived without its cover path (a shape that did not select it).
    const missing = profiles.filter((profile) => profile.coverPath === undefined).map((profile) => profile.id)
    const pathsById = missing.length ? await mediaRepository.getMediaPaths(missing) : new Map<string, { avatarPath: string | null; coverPath: string | null }>()

    return Promise.all(profiles.map(async (profile) => {
      const media = profile.coverPath === undefined ? pathsById.get(profile.id) : { avatarPath: profile.avatarPath, coverPath: profile.coverPath }
      const avatarPath = media?.avatarPath ?? profile.avatarPath
      const coverPath = media?.coverPath ?? null
      const [avatarUrl, coverUrl] = await Promise.all([
        avatarPath ? createReadUrl(avatarPath) : Promise.resolve(null),
        coverPath && !options.avatarOnly ? createReadUrl(coverPath) : Promise.resolve(null),
      ])
      return { ...profile, avatarPath, avatarUrl, coverPath, coverUrl }
    }))
  }

  async function hydrateOne<T extends PublicProfile>(profile: T | null): Promise<T | null> {
    if (!profile) return null
    return (await hydrateProfiles([profile]))[0] ?? null
  }

  async function getAwsOwnProfile() {
    const user = await input.requireUser()
    return hydrateOne(await input.repository.getOwnProfile(user.id))
  }

  async function getAwsPublicProfileBySlug(slug: string) {
    const viewer = await input.getVerifiedUser()
    return hydrateOne(await input.repository.getPublicProfileBySlug(
      viewer ? { slug, viewerProfileId: viewer.id } : { slug },
    ))
  }

  async function getAwsPublicProfileById(profileId: string) {
    const viewer = await input.getVerifiedUser()
    return hydrateOne(await input.repository.getPublicProfileById(
      viewer ? { profileId, viewerProfileId: viewer.id } : { profileId },
    ))
  }

  async function getAwsPublicProfilesByIds(ids: string[]) {
    const user = await input.requireUser()
    return hydrateProfiles(await input.repository.getPublicProfilesByIds({
      ids,
      viewerProfileId: user.id,
    }))
  }

  async function getAwsNetworkProfiles(limit = 18, searchQuery = '') {
    const user = await input.requireUser()
    const normalizedSearch = searchQuery.trim()
    const profiles = await input.repository.getDiscoveryCandidates({
      viewerProfileId: user.id,
      limit,
      ...(normalizedSearch ? { searchQuery: normalizedSearch } : {}),
    })
    const publicProfiles = profiles.filter((profile) => !isSyntheticDiscoveryText([
      profile.slug,
      profile.fullName,
      profile.headline,
      profile.summary,
      profile.rank,
      profile.currentCompany,
    ].filter(Boolean).join(' ')))

    return hydrateProfiles(publicProfiles)
  }

  /** People you may know: every exclusion and the limit run in SQL; only the returned cards are signed. */
  async function getAwsPeopleSuggestions(limit: number) {
    const user = await input.requireUser()
    const profiles = await input.repository.getPeopleSuggestions({
      viewerProfileId: user.id,
      limit,
      weights: RECOMMENDATION_WEIGHTS,
      declinedRequestWindow: DECLINED_REQUEST_SUGGESTION_WINDOW,
    })
    return hydrateProfiles(profiles, { avatarOnly: true })
  }

  /** Cards for these members in this order (blocked or inactive members left out); only avatars are signed. */
  async function getAwsProfileCards(ids: string[]) {
    const user = await input.requireUser()
    if (!ids.length) return []
    return hydrateProfiles(await input.repository.getPublicProfilesByIds({ ids, viewerProfileId: user.id }), { avatarOnly: true })
  }

  return {
    getAwsOwnProfile,
    getAwsPeopleSuggestions,
    getAwsProfileCards,
    getAwsPublicProfileBySlug,
    getAwsPublicProfileById,
    getAwsPublicProfilesByIds,
    getAwsNetworkProfiles,
  }
}

/**
 * Owner (18 Nov): a member's own profile (the header avatar and name on every page) is kept for a minute per server and
 * cleared everywhere the moment it changes (profile, maritime profile, skills, account status: p:<id>; the linked
 * company: co:<id>). Unsigned rows only: the avatar and cover links are still signed per request.
 */
export const OWN_PROFILE_CACHE_MS = 60_000
const productionRepository = createProfileRepository()
const ownProfileCache = createClearableCache<Awaited<ReturnType<typeof productionRepository.getOwnProfile>>>({
  hub: cacheClearHub, ttlMs: OWN_PROFILE_CACHE_MS, maxEntries: 5000,
})

export function ownProfileCacheTags(profileId: string, profile: unknown): string[] | null {
  if (!profile) return null
  const row = profile as { currentCompanyId?: string | null; maritime_profiles?: { current_company_id?: string | null } | null }
  const companyId = row.maritime_profiles?.current_company_id ?? row.currentCompanyId ?? null
  return companyId ? [`p:${profileId}`, `co:${companyId}`] : [`p:${profileId}`]
}

const productionQueries = createAwsProfileQueries({
  getVerifiedUser: getAwsVerifiedUser,
  requireUser: requireAwsUser,
  repository: {
    ...productionRepository,
    getOwnProfile: (profileId: string) => ownProfileCache.getOrLoad(
      profileId, () => productionRepository.getOwnProfile(profileId), (profile) => ownProfileCacheTags(profileId, profile),
    ),
  },
})

export const getAwsOwnProfile = productionQueries.getAwsOwnProfile
export const getAwsPublicProfileBySlug = productionQueries.getAwsPublicProfileBySlug
export const getAwsPublicProfileById = productionQueries.getAwsPublicProfileById
export const getAwsPublicProfilesByIds = productionQueries.getAwsPublicProfilesByIds
export const getAwsNetworkProfiles = productionQueries.getAwsNetworkProfiles
export const getAwsPeopleSuggestions = productionQueries.getAwsPeopleSuggestions
export const getAwsProfileCards = productionQueries.getAwsProfileCards
