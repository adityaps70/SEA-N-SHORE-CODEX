import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { adminRepository } from '@/features/admin/repository'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const restoreSchema = z.object({
  reason: z.string().trim().min(10).max(4000),
})

function json(payload: { ok: boolean; error?: string }, status: number) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function restoreError(error: unknown) {
  if (error instanceof AwsAuthenticationRequiredError) {
    return json({ ok: false, error: 'Your session has expired. Sign in again and retry.' }, 401)
  }
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') {
    return json({ ok: false, error: 'You do not have permission to recover deleted content.' }, 403)
  }
  if (code === 'deleted_post_not_found') {
    return json({ ok: false, error: 'This deleted post could not be found.' }, 404)
  }
  if (code === 'deleted_post_retention_expired') {
    return json({ ok: false, error: 'This post has passed its recovery deadline and can no longer be restored.' }, 409)
  }
  return json({ ok: false, error: 'The post could not be restored. Please try again.' }, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ postId: string }> },
) {
  let admin: Awaited<ReturnType<typeof requirePlatformAdministratorUser>>
  try {
    admin = await requirePlatformAdministratorUser()
  } catch (error) {
    return restoreError(error)
  }

  const { postId } = await context.params
  if (!z.string().uuid().safeParse(postId).success) {
    return json({ ok: false, error: 'Invalid post identifier.' }, 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Invalid recovery request.' }, 400)
  }

  const parsed = restoreSchema.safeParse(body)
  if (!parsed.success) {
    return json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Add a valid recovery reason.',
    }, 400)
  }

  try {
    await adminRepository.restoreDeletedPost(admin.id, postId, parsed.data.reason)
    revalidatePath('/admin/deleted-content')
    revalidatePath('/admin/moderation')
    revalidatePath('/home')
    revalidatePath('/posts/[id]', 'page')
    return json({ ok: true }, 200)
  } catch (error) {
    return restoreError(error)
  }
}
