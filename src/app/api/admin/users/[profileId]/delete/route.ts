import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { runtimeAdminUserControlService } from '@/features/admin/runtime-user-control-service'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  confirmation: z.literal('DELETE', {
    message: 'Type DELETE exactly to confirm permanent account deletion.',
  }),
  reason: z.string().trim().min(10, 'Add a clear reason of at least 10 characters.').max(2000),
})

function json(payload: { ok: boolean; error?: string }, status: number) {
  return Response.json(payload, {
    status,
    headers: { 'Cache-Control': 'private, no-store' },
  })
}

function errorResponse(error: unknown) {
  if (error instanceof AwsAuthenticationRequiredError) {
    return json({ ok: false, error: 'Sign in again to continue.' }, 401)
  }
  const code = error instanceof Error ? error.message : ''
  if (code === 'admin_forbidden') return json({ ok: false, error: 'Administrator access is required.' }, 403)
  if (code === 'admin_user_not_found') return json({ ok: false, error: 'This user could not be found.' }, 404)
  if (code === 'admin_user_self_action_forbidden') return json({ ok: false, error: 'You cannot permanently delete your own administrator account.' }, 409)
  if (code === 'admin_user_target_administrator_forbidden') return json({ ok: false, error: 'Administrator accounts require a separate privileged removal process.' }, 409)
  if (code === 'admin_user_deleted') return json({ ok: false, error: 'This account has already been permanently deleted.' }, 409)
  if (code === 'admin_user_identity_unavailable') return json({ ok: false, error: 'This account does not have a removable sign-in identity.' }, 409)
  if (code === 'admin_user_cleanup_failed') return json({ ok: false, error: 'The sign-in identity was removed, but account cleanup needs administrator support.' }, 500)
  return json({ ok: false, error: 'The account could not be permanently deleted safely. Please try again.' }, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ profileId: string }> },
) {
  let admin: Awaited<ReturnType<typeof requirePlatformAdministratorUser>>
  try {
    admin = await requirePlatformAdministratorUser()
  } catch (error) {
    return errorResponse(error)
  }

  const { profileId } = await context.params
  if (!z.string().uuid().safeParse(profileId).success) {
    return json({ ok: false, error: 'Invalid user account.' }, 400)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Invalid permanent deletion request.' }, 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid permanent deletion request.' }, 400)
  }

  try {
    await runtimeAdminUserControlService.permanentlyDeleteAccount(
      admin.id,
      profileId,
      parsed.data.reason,
    )
    return json({ ok: true }, 200)
  } catch (error) {
    return errorResponse(error)
  }
}
