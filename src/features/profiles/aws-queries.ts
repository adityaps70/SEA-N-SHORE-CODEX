import {
  getAwsVerifiedUser,
  requireAwsUser,
  type AwsVerifiedUser,
} from '@/features/auth/aws-queries'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { createProfileMediaRepository, profileMediaRepository } from './profile-media-repository'
import { createProfileRepository } from './repository'
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
  const createReadUrl = input.createReadUrl ?? createMediaReadUrl

  async function hydrateProfiles<T extends PublicProfile>(profiles: T[]): Promise<T[]> {
    if (!profiles.length) return profiles
    const pathsById = await mediaRepository.getMediaPaths(profiles.map((profile) => profile.id))

    return Promise.all(profiles.map(async (profile) => {
      const media = pathsById.get(profile.id)
      const avatarPath = media?.avatarPath ?? profile.avatarPath
      const coverPath = media?.coverPath ?? null
      const [avatarUrl, coverUrl] = await Promise.all([
        avatarPath ? createReadUrl(avatarPath) : Promise.resolve(null),
        coverPath ? createReadUrl(coverPath) : Promise.resolve(null),
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
    return hydrateProfiles(await input.repository.getDiscoveryCandidates({
      viewerProfileId: user.id,
      limit,
      ...(normalizedSearch ? { searchQuery: normalizedSearch } : {}),
    }))
  }

  return {
    getAwsOwnProfile,
    getAwsPublicProfileBySlug,
    getAwsPublicProfileById,
    getAwsPublicProfilesByIds,
    getAwsNetworkProfiles,
  }
}

const productionQueries = createAwsProfileQueries({
  getVerifiedUser: getAwsVerifiedUser,
  requireUser: requireAwsUser,
  repository: createProfileRepository(),
})

export const getAwsOwnProfile = productionQueries.getAwsOwnProfile
export const getAwsPublicProfileBySlug = productionQueries.getAwsPublicProfileBySlug
export const getAwsPublicProfileById = productionQueries.getAwsPublicProfileById
export const getAwsPublicProfilesByIds = productionQueries.getAwsPublicProfilesByIds
export const getAwsNetworkProfiles = productionQueries.getAwsNetworkProfiles
