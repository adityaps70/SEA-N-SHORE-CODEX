'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getNetworkHub } from '@/features/network/queries'
import { getAwsNetworkProfiles } from '@/features/profiles/aws-queries'
import { feedRepository } from './repository'

/** A member the composer may tag in a photo (round 9B). */
export type PhotoTagCandidate = {
  id: string
  slug: string
  fullName: string
  avatarUrl: string | null
  detail: string
  /** True for the member's accepted connections, which are listed first. */
  connected: boolean
}

export type PhotoTagCandidatesResult =
  | { ok: true; candidates: PhotoTagCandidate[] }
  | { ok: false; error: string }

export type RemovePhotoTagResult =
  | { ok: true }
  | { ok: false; error: string }

const CONNECTION_LIMIT = 12
const OTHER_MEMBER_LIMIT = 8
const CANDIDATES_ERROR = 'We could not load people to tag. Check your internet connection and try again.'
const REMOVE_PHOTO_TAG_ERROR = 'You can only remove your own tag.'

const candidateSearchSchema = z.object({ query: z.string().trim().max(80).default('') })

const removePhotoTagSchema = z.object({
  postId: z.string().uuid(),
  mediaId: z.string().uuid(),
  /** Defaults to the signed-in member; the post author may name any tagged member. */
  profileId: z.string().uuid().optional(),
})

function candidateDetail(profile: { rank: string | null; currentCompany: string | null; headline: string | null }) {
  return [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || profile.headline || 'Maritime professional'
}

type CandidateProfile = {
  id: string
  slug: string
  fullName: string
  avatarUrl?: string | null
  rank: string | null
  currentCompany: string | null
  headline: string | null
}

function toCandidate(profile: CandidateProfile, connected: boolean): PhotoTagCandidate {
  return {
    id: profile.id,
    slug: profile.slug,
    fullName: profile.fullName,
    avatarUrl: profile.avatarUrl ?? null,
    detail: candidateDetail(profile),
    connected,
  }
}

/**
 * People the signed-in member can tag in a photo: accepted connections first, then other
 * members matching the search. Blocked pairs are dropped again server-side when the post
 * is created (`insertPhotoTags`).
 */
export async function searchPhotoTagCandidates(query: string): Promise<PhotoTagCandidatesResult> {
  const parsed = candidateSearchSchema.safeParse({ query })
  if (!parsed.success) return { ok: false, error: 'Search with 80 characters or fewer.' }
  try {
    const [hub, others] = await Promise.all([
      getNetworkHub('connections', parsed.data.query),
      getAwsNetworkProfiles(OTHER_MEMBER_LIMIT, parsed.data.query).catch(() => []),
    ])
    const candidates = hub.profiles.slice(0, CONNECTION_LIMIT).map((profile) => toCandidate(profile, true))
    const seen = new Set(candidates.map((candidate) => candidate.id))
    for (const profile of others) {
      if (seen.has(profile.id)) continue
      seen.add(profile.id)
      candidates.push(toCandidate(profile, false))
    }
    return { ok: true, candidates }
  } catch {
    return { ok: false, error: CANDIDATES_ERROR }
  }
}

/**
 * Removes a photo tag. The repository only deletes when the signed-in member is the tagged
 * person or the post's author, so a member cannot untag anyone else.
 */
export async function removeMyPhotoTag(input: { postId: string; mediaId: string; profileId?: string }): Promise<RemovePhotoTagResult> {
  const parsed = removePhotoTagSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'This tag could not be found.' }

  const user = await requireAwsUser()
  const profileId = parsed.data.profileId ?? user.id
  try {
    const removed = await feedRepository.deletePhotoTag(user.id, parsed.data.postId, parsed.data.mediaId, profileId)
    if (!removed) return { ok: false, error: REMOVE_PHOTO_TAG_ERROR }
  } catch {
    return { ok: false, error: 'We could not remove this tag. Please try again.' }
  }

  revalidatePath('/home')
  revalidatePath('/posts/[id]', 'page')
  revalidatePath('/people/[slug]', 'page')
  return { ok: true }
}
