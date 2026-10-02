import type { Metadata } from 'next'
import Link from 'next/link'
import { GoogleMark } from '@/features/auth/components/google-mark'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { prepareLegacyProfileClaim } from '@/features/auth/legacy-claim-actions'
import { getCognitoEnvironment } from '@/lib/env'

export const metadata: Metadata = { title: 'Claim your old profile' }

export default async function ClaimProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const params = await searchParams
  const googleEnabled = getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED
  const emailError = params.error === 'email'

  return (
    <AuthShell>
      <div className="mt-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ocean-700">Returning Sea N Shore member</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-[-0.04em] text-navy-950">
          Claim your restored profile
        </h1>
        <p className="mt-3 leading-7 text-muted">
          We restored profiles from the old Sea N Shore website. Your old password was not moved.
          Use the same email address you used on the old website and we&apos;ll connect your new login
          to the restored profile after verification.
        </p>
      </div>

      {googleEnabled ? (
        <>
          <a
            href="/auth/google/start?intent=sign-in"
            className="mt-6 inline-flex min-h-12 w-full items-center justify-center gap-3 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm transition-colors hover:bg-mist-50"
          >
            <GoogleMark />
            Continue with Google
          </a>
          <p className="mt-2 text-sm leading-6 text-muted">
            Choose the Google account that uses your old registered Sea N Shore email.
          </p>

          <div className="mt-6 flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
            <span className="h-px flex-1 bg-mist-100" />
            <span>or use email</span>
            <span className="h-px flex-1 bg-mist-100" />
          </div>
        </>
      ) : null}

      <form action={prepareLegacyProfileClaim} className="mt-6 grid gap-4">
        <label className="grid gap-2 text-sm font-semibold text-navy-950" htmlFor="legacy-email">
          Old registered email
          <input
            id="legacy-email"
            name="email"
            type="email"
            aria-label="Old registered email"
            required
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            className="min-h-12 rounded-xl border border-mist-200 bg-white px-4 text-base font-normal outline-none transition focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
            aria-describedby="legacy-email-help"
          />
        </label>
        <p id="legacy-email-help" className="text-sm leading-6 text-muted">
          We won&apos;t confirm publicly whether an email is in the old database. After you verify it,
          any matching restored profile will be connected automatically.
        </p>
        {emailError ? (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            Enter a valid email address.
          </p>
        ) : null}
        <button
          type="submit"
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-ocean-800"
        >
          Continue with email
        </button>
      </form>

      <div className="mt-6 rounded-xl bg-mist-50 p-4 text-sm leading-6 text-muted">
        <strong className="text-navy-950">What happens next?</strong>{' '}
        Create a new password and verify this email. Sea N Shore will then restore the matching
        profile for review instead of creating a second profile.
      </div>

      <p className="mt-6 text-sm">
        <Link
          href="/auth/sign-in"
          className="font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline"
        >
          Back to sign in
        </Link>
      </p>
    </AuthShell>
  )
}
