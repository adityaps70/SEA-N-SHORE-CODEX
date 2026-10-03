import { runtimeDeletionCodeService, getDeletionReauth } from '@/features/account-deletion/reauth-runtime'
import { AwsAuthenticationRequiredError, requireAwsUser } from '@/features/auth/aws-queries'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function json(payload: { ok: boolean; error?: string; message?: string }, status: number) {
  return Response.json(payload, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

/** Texts a one-time code to a mobile-only member so they can confirm deleting their account. */
export async function POST() {
  try {
    const user = await requireAwsUser()
    const reauth = await getDeletionReauth(user)
    if (reauth.method !== 'phone_code') {
      return json({ ok: false, error: 'Your account confirms deletion another way. Refresh the page and try again.' }, 409)
    }
    const result = await (await runtimeDeletionCodeService()).sendCode({ id: user.id, cognitoSub: user.cognitoSub }, reauth)
    return result.ok ? json({ ok: true, message: result.message }, 200) : json({ ok: false, error: result.error }, 429)
  } catch (error) {
    if (error instanceof AwsAuthenticationRequiredError) return json({ ok: false, error: 'Your session has expired. Sign in again and retry.' }, 401)
    return json({ ok: false, error: 'We couldn’t send a code just now. Please try again.' }, 500)
  }
}
