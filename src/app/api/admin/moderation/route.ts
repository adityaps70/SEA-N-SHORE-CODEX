import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { adminRepository } from '@/features/admin/repository'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { MODERATION_TARGET_TYPES } from '@/features/moderation/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = {
  'Cache-Control': 'private, no-store',
}

const moderationSchema = z.object({
  targetType: z.enum(MODERATION_TARGET_TYPES),
  targetId: z.string().uuid(),
  action: z.enum(['reviewing', 'dismiss', 'resolve', 'remove', 'restore']),
  note: z.preprocess(
    (value) => {
      if (typeof value !== 'string') return null
      const normalized = value.trim()
      return normalized || null
    },
    z.string().max(4000).nullable(),
  ),
}).superRefine((value, context) => {
  if (value.action !== 'reviewing' && !value.note) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['note'],
      message: 'Add a moderation note for this action.',
    })
  }
})

function json(payload: { ok: boolean; error?: string }, status: number) {
  return Response.json(payload, {
    status,
    headers: NO_STORE_HEADERS,
  })
}

function moderationError(error: unknown) {
  if (error instanceof AwsAuthenticationRequiredError) {
    return json({ ok: false, error: 'Your session has expired. Sign in again and retry.' }, 401)
  }

  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') {
    return json({ ok: false, error: 'You do not have permission to moderate platform content.' }, 403)
  }
  if (code === 'moderation_case_not_found') {
    return json({ ok: false, error: 'This moderation case could not be found.' }, 404)
  }
  if (code === 'moderation_target_not_found') {
    return json({ ok: false, error: 'The reported content is no longer available.' }, 404)
  }
  if (code === 'moderation_restore_forbidden') {
    return json({ ok: false, error: 'This content was not removed by moderation, so it cannot be restored from this console.' }, 409)
  }

  return json({ ok: false, error: 'The moderation action could not be saved. Please try again.' }, 500)
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof requirePlatformAdministratorUser>>
  try {
    user = await requirePlatformAdministratorUser()
  } catch (error) {
    return moderationError(error)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Invalid moderation request.' }, 400)
  }

  const parsed = moderationSchema.safeParse(body)
  if (!parsed.success) {
    return json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Invalid moderation request.',
    }, 400)
  }

  try {
    await adminRepository.moderateContent(user.id, {
      targetType: parsed.data.targetType,
      targetId: parsed.data.targetId,
      action: parsed.data.action,
      note: parsed.data.note,
    })

    revalidatePath('/admin')
    revalidatePath('/admin/moderation')
    if (parsed.data.targetType === 'post' || parsed.data.targetType === 'comment') {
      revalidatePath('/home')
      revalidatePath('/posts/[id]', 'page')
    }
    if (parsed.data.targetType === 'job') {
      revalidatePath('/jobs')
      revalidatePath(`/jobs/${parsed.data.targetId}`)
    }
    if (parsed.data.targetType === 'event') {
      revalidatePath('/events')
      revalidatePath(`/events/${parsed.data.targetId}`)
    }

    return json({ ok: true }, 200)
  } catch (error) {
    return moderationError(error)
  }
}
