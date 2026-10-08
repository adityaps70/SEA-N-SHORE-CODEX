import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { AuthForm } from '@/features/auth/components/auth-form'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { confirmSignInMfa } from '@/features/auth/actions'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'

export const metadata: Metadata = { title: 'Two-step verification' }

const linkClass = 'font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline'

/**
 * Round 14 (2.11): second sign-in step for members with an authenticator app. The Cognito
 * session from the password step stays in HTTP-only cookies; this page only checks it exists.
 */
export default async function MfaSignInPage() {
  const cookieStore = await cookies()
  const pending = Boolean(
    cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallenge)?.value
    && cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeUser)?.value,
  )

  return (
    <AuthShell>
      {pending ? (
        <AuthForm
          mode="verify-mfa"
          action={confirmSignInMfa}
          lead={
            <p className="mt-2 text-sm leading-6 text-muted">
              Open the authenticator app you set up for Sea N Shore and enter the 6-digit code it shows.
            </p>
          }
        />
      ) : (
        <div>
          <h1 className="text-3xl font-semibold tracking-[-0.04em] text-navy-950">Enter your authenticator code</h1>
          <p role="alert" className="mt-7 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Your sign-in session expired. Please sign in again.
          </p>
        </div>
      )}
      <p className="mt-6 text-sm">
        <Link href="/auth/sign-in" className={linkClass}>Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
