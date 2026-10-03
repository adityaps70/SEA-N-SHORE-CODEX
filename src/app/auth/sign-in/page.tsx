import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import Link from "next/link";
import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthMethodLinks } from "@/features/auth/components/auth-method-links";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { signIn } from "@/features/auth/actions";
import { getCognitoEnvironment } from "@/lib/env";
import { OAuthErrorNotice } from "@/components/feedback/oauth-error-notice";
import { LEGACY_CLAIM_EMAIL_COOKIE } from "@/features/auth/legacy-claim";

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string | string[]; error?: string | string[] }>;
}) {
  const googleEnabled = getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED;
  const { oauthError, error } = await searchParams;
  const claimEmail = (await cookies()).get(LEGACY_CLAIM_EMAIL_COOKIE)?.value;

  return (
    <AuthShell>
      <OAuthErrorNotice code={oauthError ?? error} />
      {/* Phones: Google first (when enabled), then "or" and the email form. Desktop keeps it below the form. */}
      {claimEmail ? (
        <p className="mt-4 rounded-lg bg-mist-50 px-4 py-3 text-sm leading-6 text-ocean-800" role="status">
          Finish claiming your restored profile by signing in with the new password for <strong>{claimEmail}</strong>.
        </p>
      ) : null}
      <AuthForm
        mode="sign-in"
        action={signIn}
        initialEmail={claimEmail}
        lead={<AuthMethodLinks intent="sign-in" googleEnabled={googleEnabled} placement="above" />}
      />
      <AuthMethodLinks intent="sign-in" googleEnabled={googleEnabled} />
      <div className="mt-6 rounded-xl border border-ocean-100 bg-ocean-50/50 p-4">
        <p className="text-sm font-semibold text-navy-950">Had an account on the old Sea N Shore website?</p>
        <Link
          href="/auth/claim-profile"
          className="mt-2 inline-flex min-h-10 items-center font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline"
        >
          Claim your restored profile
        </Link>
      </div>
      <p className="mt-6 text-sm text-muted max-md:text-center max-md:text-base max-md:text-navy-950">
        New to Sea N Shore?{" "}
        <Link href="/auth/sign-up" className="font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">
          <span className="md:hidden">Join now</span>
          <span className="max-md:hidden">Create your profile</span>
        </Link>
      </p>
      <p className="mt-3 text-sm max-md:hidden">
        <Link href="/auth/forgot-password" className="font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline">Forgot password?</Link>
      </p>
    </AuthShell>
  );
}
