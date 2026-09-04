import {
  getAwsVerifiedUser,
  requireAwsUser,
  type AwsVerifiedUser,
} from '@/features/auth/aws-queries'
import { createProfileRepository } from './repository'

type GetVerifiedUser = () => Promise<AwsVerifiedUser | null>
type RequireUser = () => Promise<AwsVerifiedUser>
type ProfileRepository = ReturnType<typeof createProfileRepository>

export function createAwsProfileQueries(input: {
  getVerifiedUser: GetVerifiedUser
  requireUser: RequireUser
  repository: ProfileRepository
}) {
  async function getAwsOwnProfile() {
    const user = await input.requireUser()
    return input.repository.getOwnProfile(user.id)
  }

  async function getAwsPublicProfileBySlug(slug: string) {
    const viewer = await input.getVerifiedUser()
    return input.repository.getPublicProfileBySlug(
      viewer ? { slug, viewerProfileId: viewer.id } : { slug },
    )
  }

  async function getAwsPublicProfileById(profileId: string) {
    const viewer = await input.getVerifiedUser()
    return input.repository.getPublicProfileById(
      viewer ? { profileId, viewerProfileId: viewer.id } : { profileId },
    )
  }

  async function getAwsPublicProfilesByIds(ids: string[]) {
    const user = await input.requireUser()
    return input.repository.getPublicProfilesByIds({
      ids,
      viewerProfileId: user.id,
    })
  }

  async function getAwsNetworkProfiles(limit = 18) {
    const user = await input.requireUser()
    return input.repository.getDiscoveryCandidates({
      viewerProfileId: user.id,
      limit,
    })
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
