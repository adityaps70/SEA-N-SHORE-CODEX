import { getVerifiedUser } from '@/features/auth/queries'
import { captionRepository } from '@/features/learning/caption-repository'
import { getMediaObject } from '@/lib/aws/storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_CAPTION_BYTES = 2 * 1024 * 1024

/**
 * A video's WebVTT captions, from this site's own address so the player's <track> and transcript
 * can read them (the media bucket allows cross-origin uploads only). Enrolled learners once the
 * video is released to them, and anyone for a free-preview video (learning round A, A7).
 */
export async function GET(_request: Request, context: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = await context.params
  if (!UUID.test(lessonId)) return new Response('Not found', { status: 404 })

  const user = await getVerifiedUser()
  const path = await captionRepository.captionPathForViewer(lessonId, user?.id ?? null)
  if (!path) return new Response('Not found', { status: 404 })

  try {
    const object = await getMediaObject({ key: path, maxBytes: MAX_CAPTION_BYTES })
    const text = new TextDecoder('utf-8').decode(object.body).replace(/^﻿/, '')
    if (!text.startsWith('WEBVTT')) return new Response('Not found', { status: 404 })
    return new Response(text, {
      status: 200,
      headers: {
        'content-type': 'text/vtt; charset=utf-8',
        'cache-control': 'private, max-age=300',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
