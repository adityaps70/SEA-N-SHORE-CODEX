import { describe, expect, it, vi } from 'vitest'
import type { AwsVerifiedUser } from '@/features/auth/aws-queries'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'

const verifiedUser: AwsVerifiedUser = {
  id: VIEWER_ID,
  cognitoSub: 'cognito-sub-1',
  email: 'member@example.com',
}

function repository() {
  return {
    getOwnProfile: vi.fn(async () => null),
    getPublicProfileBySlug: vi.fn(async () => null),
    getPublicProfileById: vi.fn(async () => null),
    getPublicProfilesByIds: vi.fn(async () => []),
    getDiscoveryCandidates: vi.fn(async () => []),
  }
}

describe('AWS profile queries', () => {
  it('loads own profile with the permanent Sea N Shore profile UUID', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => verifiedUser)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsOwnProfile()

    expect(profileRepository.getOwnProfile).toHaveBeenCalledWith(VIEWER_ID)
    expect(profileRepository.getOwnProfile).not.toHaveBeenCalledWith('cognito-sub-1')
  })

  it('loads an anonymous public slug without inventing viewer block context', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => null)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsPublicProfileBySlug('captain-ananya-rao')

    expect(profileRepository.getPublicProfileBySlug).toHaveBeenCalledWith({
      slug: 'captain-ananya-rao',
    })
  })

  it('loads an authenticated public slug with the permanent viewer UUID for block exclusion', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => verifiedUser)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsPublicProfileBySlug('captain-ananya-rao')

    expect(profileRepository.getPublicProfileBySlug).toHaveBeenCalledWith({
      slug: 'captain-ananya-rao',
      viewerProfileId: VIEWER_ID,
    })
  })

  it('loads a public profile by ID with optional authenticated block context', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => verifiedUser)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsPublicProfileById(TARGET_ID)

    expect(profileRepository.getPublicProfileById).toHaveBeenCalledWith({
      profileId: TARGET_ID,
      viewerProfileId: VIEWER_ID,
    })
  })

  it('hydrates profile IDs using the permanent viewer UUID', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => verifiedUser)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsPublicProfilesByIds([TARGET_ID])

    expect(profileRepository.getPublicProfilesByIds).toHaveBeenCalledWith({
      ids: [TARGET_ID],
      viewerProfileId: VIEWER_ID,
    })
  })

  it('loads discovery candidates with current default and bounded repository semantics', async () => {
    const profileRepository = repository()
    const requireUser = vi.fn(async () => verifiedUser)
    const getVerifiedUser = vi.fn(async () => verifiedUser)
    const { createAwsProfileQueries } = await import('./aws-queries')
    const queries = createAwsProfileQueries({
      requireUser,
      getVerifiedUser,
      repository: profileRepository,
    })

    await queries.getAwsNetworkProfiles()
    await queries.getAwsNetworkProfiles(42)

    expect(profileRepository.getDiscoveryCandidates).toHaveBeenNthCalledWith(1, {
      viewerProfileId: VIEWER_ID,
      limit: 18,
    })
    expect(profileRepository.getDiscoveryCandidates).toHaveBeenNthCalledWith(2, {
      viewerProfileId: VIEWER_ID,
      limit: 42,
    })
  })
})
