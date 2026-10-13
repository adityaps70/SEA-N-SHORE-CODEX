'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { FEED_FEEDBACK_KINDS, SUGGESTION_KINDS, incrementRankingMetric, signalsRepository } from './repository'

export type SignalActionResult = { ok: true } | { ok: false; error: string }

const uuid = z.string().uuid()

async function run(work: (viewerId: string) => Promise<unknown>, fallback: string): Promise<SignalActionResult> {
  try {
    const user = await requireAwsUser()
    await work(user.id)
    return { ok: true }
  } catch {
    return { ok: false, error: fallback }
  }
}

/** Hides this member's posts from the viewer's feed, without blocking or telling them. */
export async function muteMemberAction(profileId: string): Promise<SignalActionResult> {
  if (!uuid.safeParse(profileId).success) return { ok: false, error: 'Invalid member.' }
  const result = await run((viewerId) => signalsRepository.muteProfile(viewerId, profileId), 'We could not mute this member. Please try again.')
  if (result.ok) revalidatePath('/settings/blocked')
  return result
}

/** Hides this organization's posts from the viewer's feed. */
export async function muteOrganizationAction(companyId: string): Promise<SignalActionResult> {
  if (!uuid.safeParse(companyId).success) return { ok: false, error: 'Invalid organization.' }
  const result = await run((viewerId) => signalsRepository.muteOrganization(viewerId, companyId), 'We could not mute this organization. Please try again.')
  if (result.ok) revalidatePath('/settings/blocked')
  return result
}

export async function unmuteAction(muteId: string): Promise<SignalActionResult> {
  if (!uuid.safeParse(muteId).success) return { ok: false, error: 'Invalid entry.' }
  const result = await run(async (viewerId) => {
    if (!await signalsRepository.unmute(viewerId, muteId)) throw new Error('not_found')
  }, 'We could not unmute. Please try again.')
  if (result.ok) {
    revalidatePath('/settings/blocked')
    revalidatePath('/home')
  }
  return result
}

/** The X on a suggestion card: hidden for 180 days. */
export async function dismissSuggestionAction(kind: string, targetId: string): Promise<SignalActionResult> {
  const parsedKind = z.enum(SUGGESTION_KINDS).safeParse(kind)
  if (!parsedKind.success || !uuid.safeParse(targetId).success) return { ok: false, error: 'Invalid suggestion.' }
  const result = await run((viewerId) => signalsRepository.dismissSuggestion(viewerId, parsedKind.data, targetId), 'We could not hide this suggestion. Please try again.')
  if (result.ok) void incrementRankingMetric(`${parsedKind.data === 'person' ? 'pymk' : `suggest_${parsedKind.data}`}.dismissed`)
  return result
}

/** "Show less like this" / "Not relevant" from the post menu. */
export async function feedFeedbackAction(postId: string, kind: string): Promise<SignalActionResult> {
  const parsedKind = z.enum(FEED_FEEDBACK_KINDS).safeParse(kind)
  if (!parsedKind.success || !uuid.safeParse(postId).success) return { ok: false, error: 'Invalid post.' }
  const result = await run(async (viewerId) => {
    if (!await signalsRepository.recordFeedFeedback(viewerId, postId, parsedKind.data)) throw new Error('not_found')
  }, 'We could not save that. Please try again.')
  if (result.ok) void incrementRankingMetric(`feed.${parsedKind.data}`)
  return result
}
