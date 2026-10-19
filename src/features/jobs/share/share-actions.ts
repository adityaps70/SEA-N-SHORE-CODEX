'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { messageForErrorCode } from '@/lib/errors/user-messages'
import { parseShareOptions } from './share-options'
import { JobShareError } from './share-service'
import { jobShareService } from './share-runtime'

/** Round I (I1): the share panel's server actions. The service checks who may share on every call. */
export type JobSharePanelState = Awaited<ReturnType<typeof jobShareService.panelState>>

const uuid = z.string().uuid()

const MESSAGES = {
  job_share_not_found: 'This job could not be found.',
  job_share_forbidden: 'Only the job’s poster can share it.',
  job_share_closed: 'This job is closed, so it can no longer be shared.',
  job_share_too_soon: 'This job was shared to the feed in the last 7 days.',
  job_share_failed: 'We could not share the job. Please try again.',
} as const

function message(error: unknown) {
  return error instanceof JobShareError ? MESSAGES[error.code] : MESSAGES.job_share_failed
}

export async function loadJobSharePanel(jobId: string): Promise<{ ok: true; state: JobSharePanelState } | { ok: false; error: string }> {
  if (!uuid.safeParse(jobId).success) return { ok: false, error: MESSAGES.job_share_not_found }
  const user = await requireAwsUser()
  try {
    return { ok: true, state: await jobShareService.panelState(user.id, jobId) }
  } catch (error) {
    return { ok: false, error: message(error) }
  }
}

/** Counts a download, copy or phone share of the image. */
export async function recordJobImageShare(jobId: string): Promise<{ ok: boolean }> {
  if (!uuid.safeParse(jobId).success) return { ok: false }
  const user = await requireAwsUser()
  try {
    await jobShareService.recordImageShare(user.id, jobId)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

export async function shareJobToFeed(input: { jobId: string; size: string; look: string; opts: string; caption: string }): Promise<
  { ok: true; postId: string } | { ok: false; error: string; nextAt?: string | null }
> {
  if (!uuid.safeParse(input.jobId).success) return { ok: false, error: MESSAGES.job_share_not_found }
  const user = await requireAwsUser()
  try {
    const access = await jobShareService.access(user.id, input.jobId)
    if (!access) return { ok: false, error: MESSAGES.job_share_forbidden }
    const options = parseShareOptions(new URLSearchParams({ size: input.size, look: input.look, opts: input.opts }), access.job)
    const { postId } = await jobShareService.postToFeed(user.id, input.jobId, { options, caption: String(input.caption ?? '').slice(0, 3000) })
    revalidatePath('/home')
    revalidatePath('/hiring/jobs')
    return { ok: true, postId }
  } catch (error) {
    // The normal post rate limit applies to feed shares too.
    if (error instanceof Error && error.message === 'feed_post_rate_limited') return { ok: false, error: messageForErrorCode('feed_post_rate_limited') }
    if (error instanceof JobShareError && error.code === 'job_share_too_soon') return { ok: false, error: MESSAGES.job_share_too_soon, nextAt: error.nextAt }
    if (!(error instanceof JobShareError)) console.error('[job_share_feed_failed]', { name: error instanceof Error ? error.name : 'unknown' })
    return { ok: false, error: message(error) }
  }
}
