import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from 'next/link'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { BackupCodeSignInForm } from '@/features/account-security/components/backup-code-sign-in-form'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'

export const metadata: Metadata = { title: 'Use a backup code' }

const linkClass = 'font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline'

/**
 * Round H (H3): the 2FA sign-in step with a backup code instead of the authenticator app. Works only for the sign-in
 * whose password step just succeeded in this browser (the server-signed MFA challenge cookies).
 */
export default async function BackupCodeSignInPage() {
  const cookieStore = await cookies()
  const pending = Boolean(
    cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallenge)?.value
    && cookieStore.get(COGNITO_COOKIE_NAMES.mfaChallengeUser)?.value,
  )

  return (
    <AuthShell>
      <h1 className="text-3xl font-semibold tracking-[-0.04em] text-navy-950">Use a backup code</h1>
      {pending ? (
        <>
          <p className="mt-2 text-sm leading-6 text-muted">
            Lost your authenticator app? Enter one of the backup codes you saved when you set up two-step verification.
          </p>
          <BackupCodeSignInForm />
          <p className="mt-6 text-sm">
            <Link href="/auth/mfa" className={linkClass}>Use your authenticator app instead</Link>
          </p>
        </>
      ) : (
        <p role="alert" className="mt-7 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          Your sign-in session expired. Please sign in again.
        </p>
      )}
      <p className="mt-3 text-sm">
        <Link href="/auth/sign-in" className={linkClass}>Back to sign in</Link>
      </p>
    </AuthShell>
  )
}
