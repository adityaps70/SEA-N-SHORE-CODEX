import type { Metadata } from 'next'
import Link from "next/link";
import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthMethodLinks } from "@/features/auth/components/auth-method-links";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { signIn } from "@/features/auth/actions";
import { getCognitoEnvironment } from "@/lib/env";
import { OAuthErrorNotice } from "@/components/feedback/oauth-error-notice";

export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ oauthError?: string | string[] }>;
}) {
  const googleEnabled = getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED;
  const { oauthError } = await searchParams;

  return (
    <AuthShell>
      <OAuthErrorNotice code={oauthError} />
      {/* Phones: Google first (when enabled), then "or" and the email form. Desktop keeps it below the form. */}
      <AuthForm
        mode="sign-in"
        action={signIn}
        lead={<AuthMethodLinks intent="sign-in" googleEnabled={googleEnabled} placement="above" />}
      />
      <AuthMethodLinks intent="sign-in" googleEnabled={googleEnabled} />
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
