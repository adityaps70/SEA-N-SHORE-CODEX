import { cookies } from 'next/headers'
import { z } from 'zod'
import { runtimeAccountDeletionService } from '@/features/account-deletion/runtime-service'
import { AccountDeletionError } from '@/features/account-deletion/service'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const NO_STORE_HEADERS = { 'Cache-Control': 'private, no-store' }

const requestSchema = z.object({
  confirmation: z.literal('DELETE', {
    message: 'Type DELETE exactly to confirm permanent account deletion.',
  }),
  password: z.string().min(1, 'Enter your password to continue.').max(256),
})

function json(payload: { ok: boolean; error?: string; redirectTo?: string }, status: number) {
  return Response.json(payload, { status, headers: NO_STORE_HEADERS })
}

async function clearAuthCookies() {
  const store = await cookies()
  for (const name of Object.values(COGNITO_COOKIE_NAMES)) store.delete(name)
}

function safeError(error: unknown) {
  if (error instanceof AwsAuthenticationRequiredError) {
    return json({ ok: false, error: 'Your session has expired. Sign in again and retry.' }, 401)
  }
  if (error instanceof AccountDeletionError) {
    if (error.code === 'account_deletion_reauthentication_failed') {
      return json({ ok: false, error: 'Your password could not be verified. Please try again.' }, 401)
    }
    if (error.code === 'account_deletion_reauthentication_unavailable') {
      return json({
        ok: false,
        error: 'Password re-authentication is unavailable for this account. Sign in again or use account recovery before deleting it.',
      }, 409)
    }
    if (error.code === 'account_deletion_cleanup_failed') {
      return json({
        ok: false,
        error: 'Your sign-in identity was removed, but account cleanup could not fully complete. Please contact Sea N Shore support.',
      }, 500)
    }
  }
  return json({
    ok: false,
    error: 'We could not delete your account safely. Nothing else is required from you right now; please try again.',
  }, 500)
}

export async function POST(request: Request) {
  let user: Awaited<ReturnType<typeof requireAwsUser>>
  try {
    user = await requireAwsUser()
  } catch (error) {
    return safeError(error)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ ok: false, error: 'Invalid account deletion request.' }, 400)
  }

  const parsed = requestSchema.safeParse(body)
  if (!parsed.success) {
    return json({
      ok: false,
      error: parsed.error.issues[0]?.message ?? 'Check the deletion confirmation and try again.',
    }, 400)
  }

  try {
    await runtimeAccountDeletionService.deleteAccount({
      profileId: user.id,
      email: user.email,
      password: parsed.data.password,
    })
    await clearAuthCookies()
    return json({ ok: true, redirectTo: '/account-deleted' }, 200)
  } catch (error) {
    return safeError(error)
  }
}
