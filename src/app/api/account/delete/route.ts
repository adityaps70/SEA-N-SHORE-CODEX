import { cookies } from 'next/headers'
import { z } from 'zod'
import {
  deleteIdentityByUsername,
  deleteIdentityWithAccessToken,
  getDeletionReauth,
  runtimeDeletionCodeService,
} from '@/features/account-deletion/reauth-runtime'
import { RECENT_SIGN_IN_MINUTES } from '@/features/account-deletion/reauth'
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
  /** Email sign-in. */
  password: z.string().max(256).optional(),
  /** Mobile-only sign-in: the one-time code texted for this deletion. */
  code: z.string().max(12).optional(),
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
        error: 'We can’t confirm it’s you for this account right now. Sign in again, or contact info@beaufortmarine.in to delete it.',
      }, 409)
    }
    if (error.code === 'account_deletion_billing_cancel_failed') {
      return json({
        ok: false,
        error: 'We couldn’t turn off auto-renew for your plan, so nothing was deleted. Please try again in a few minutes, or turn off auto-renew in Membership & billing first.',
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
    const reauth = await getDeletionReauth(user)
    if (reauth.method === 'password') {
      if (!parsed.data.password) return json({ ok: false, error: 'Enter your password to continue.' }, 400)
      await runtimeAccountDeletionService.deleteAccount({
        profileId: user.id,
        email: user.email,
        password: parsed.data.password,
        cognitoSub: user.cognitoSub,
      })
    } else if (reauth.method === 'phone_code') {
      const verified = await (await runtimeDeletionCodeService()).verifyCode({ id: user.id, cognitoSub: user.cognitoSub }, parsed.data.code)
      if (!verified.ok) return json({ ok: false, error: verified.error }, 401)
      await runtimeAccountDeletionService.deleteVerifiedAccount({
        profileId: user.id,
        cognitoSub: user.cognitoSub,
        deleteIdentity: () => deleteIdentityWithAccessToken(verified.accessToken),
      })
    } else if (reauth.method === 'recent_sign_in') {
      if (!reauth.fresh) {
        return json({
          ok: false,
          error: `For your security, sign in with Google again, then delete your account within ${RECENT_SIGN_IN_MINUTES} minutes.`,
        }, 401)
      }
      await runtimeAccountDeletionService.deleteVerifiedAccount({
        profileId: user.id,
        cognitoSub: user.cognitoSub,
        deleteIdentity: () => deleteIdentityByUsername(reauth.username),
      })
    } else {
      throw new AccountDeletionError('account_deletion_reauthentication_unavailable')
    }
    await clearAuthCookies()
    return json({ ok: true, redirectTo: '/account-deleted' }, 200)
  } catch (error) {
    return safeError(error)
  }
}
