import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { runtimeAdminUserControlService } from '@/features/admin/runtime-user-control-service'
import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const bodySchema = z.object({
  action: z.enum(['suspend', 'restore']),
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
  if (code === 'admin_user_self_action_forbidden') return json({ ok: false, error: 'You cannot change your own administrator account from this control.' }, 409)
  if (code === 'admin_user_target_administrator_forbidden') return json({ ok: false, error: 'Administrator accounts cannot be suspended from this user control.' }, 409)
  if (code === 'admin_user_deleted') return json({ ok: false, error: 'This account has already been permanently deleted.' }, 409)
  if (code === 'admin_user_restore_forbidden') return json({ ok: false, error: 'Only a suspended account can be restored.' }, 409)
  return json({ ok: false, error: 'The account status could not be changed safely. Please try again.' }, 500)
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
    return json({ ok: false, error: 'Invalid account control request.' }, 400)
  }
  const parsed = bodySchema.safeParse(body)
  if (!parsed.success) {
    return json({ ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid account control request.' }, 400)
  }

  try {
    if (parsed.data.action === 'suspend') {
      await runtimeAdminUserControlService.suspendAccount(admin.id, profileId, parsed.data.reason)
    } else {
      await runtimeAdminUserControlService.restoreAccount(admin.id, profileId, parsed.data.reason)
    }
    return json({ ok: true }, 200)
  } catch (error) {
    return errorResponse(error)
  }
}
