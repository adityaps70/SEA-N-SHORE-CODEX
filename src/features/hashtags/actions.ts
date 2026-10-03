'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { hashtagHref, isStorableHashtag, normaliseHashtag } from './parse'
import { hashtagRepository, type HashtagSuggestion } from './repository'

const hashtagSchema = z.string().transform(normaliseHashtag).refine(isStorableHashtag, 'This hashtag is not valid.')

export type HashtagFollowActionResult =
  | { ok: true; following: boolean }
  | { ok: false; error: string }

/** Existing hashtags for the composer's "#" suggestions (prefix match, most used first). */
export async function searchHashtags(query: string): Promise<HashtagSuggestion[]> {
  const normalised = typeof query === 'string' ? query.trim().slice(0, 64) : ''
  try {
    return await hashtagRepository.searchHashtags(normalised)
  } catch {
    return []
  }
}

async function mutateHashtagFollow(tag: string, operation: 'follow' | 'unfollow'): Promise<HashtagFollowActionResult> {
  const parsed = hashtagSchema.safeParse(tag)
  if (!parsed.success) return { ok: false, error: 'This hashtag could not be found.' }

  try {
    const user = await requireAwsUser()
    const access = await getAccessContext(user.id)
    if (!access.accountActive) {
      return { ok: false, error: 'Your account cannot follow hashtags right now.' }
    }

    if (operation === 'follow') await hashtagRepository.followHashtag(user.id, parsed.data)
    else await hashtagRepository.unfollowHashtag(user.id, parsed.data)

    revalidatePath(hashtagHref(parsed.data))
    return { ok: true, following: operation === 'follow' }
  } catch {
    return { ok: false, error: 'We could not update this hashtag follow. Please try again.' }
  }
}

export async function followHashtag(tag: string) {
  return mutateHashtagFollow(tag, 'follow')
}

export async function unfollowHashtag(tag: string) {
  return mutateHashtagFollow(tag, 'unfollow')
}

/** Whether the signed-in member follows the tag (false for invalid tags or signed-out callers). */
export async function isFollowingHashtag(tag: string): Promise<boolean> {
  const parsed = hashtagSchema.safeParse(tag)
  if (!parsed.success) return false
  try {
    const user = await requireAwsUser()
    return await hashtagRepository.isFollowingHashtag(user.id, parsed.data)
  } catch {
    return false
  }
}
