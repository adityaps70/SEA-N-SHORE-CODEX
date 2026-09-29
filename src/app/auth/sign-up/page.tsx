import type { Metadata } from 'next'
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/features/auth/components/auth-form";
import { AuthMethodLinks } from "@/features/auth/components/auth-method-links";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { confirmSignUp, resendConfirmationCode, signUp } from "@/features/auth/actions";
import { getCognitoEnvironment } from "@/lib/env";
import { OAuthErrorNotice } from "@/components/feedback/oauth-error-notice";

export const metadata: Metadata = { title: 'Create your account' }

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; email?: string; resent?: string; resendError?: string; oauthError?: string }>;
}) {
  const params = await searchParams;
  const confirming = params.confirm === "1";
  const googleEnabled = getCognitoEnvironment().AWS_COGNITO_GOOGLE_ENABLED;

  return (
    <AuthShell>
      {confirming ? (
        <>
          <p className="mt-4 leading-7 text-muted">Enter the confirmation code sent to your email address.</p>
          {params.resent === "1" && (
            <p role="status" className="mt-4 rounded-lg bg-mist-50 px-4 py-3 text-sm text-ocean-700">
              A new confirmation code has been sent.
            </p>
          )}
          {params.resendError === "1" && (
            <p role="alert" className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
              We could not resend the confirmation code. Please try again shortly.
            </p>
          )}
          <AuthForm mode="confirm-sign-up" action={confirmSignUp} initialEmail={params.email} />
          <form action={resendConfirmationCode} className="mt-3">
            <input type="hidden" name="email" value={params.email ?? ""} />
            <Button type="submit" variant="secondary" className="w-full max-md:rounded-full">
              Resend confirmation code
            </Button>
          </form>
        </>
      ) : (
        <>
          <OAuthErrorNotice code={params.oauthError} />
          {/* Phones: Google and mobile number first, then "or" and the email form. */}
          <AuthForm
            mode="sign-up"
            action={signUp}
            lead={<AuthMethodLinks intent="sign-up" googleEnabled={googleEnabled} placement="above" />}
          />
          <AuthMethodLinks intent="sign-up" googleEnabled={googleEnabled} />
        </>
      )}
      <p className="mt-6 text-sm text-muted max-md:text-center max-md:text-base max-md:text-navy-950">
        Already have an account?{" "}
        <Link href="/auth/sign-in" className="font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center">Sign in</Link>
      </p>
    </AuthShell>
  );
}
