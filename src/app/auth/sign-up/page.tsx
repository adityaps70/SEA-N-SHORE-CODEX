import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { Button } from "@/components/ui/button";
import { AuthForm } from "@/features/auth/components/auth-form";
import { confirmSignUp, resendConfirmationCode, signUp } from "@/features/auth/actions";

export default async function SignUpPage({
  searchParams,
}: {
  searchParams: Promise<{ confirm?: string; email?: string; resent?: string; resendError?: string }>;
}) {
  const params = await searchParams;
  const confirming = params.confirm === "1";

  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
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
              <Button type="submit" variant="secondary" className="w-full">
                Resend confirmation code
              </Button>
            </form>
          </>
        ) : (
          <AuthForm mode="sign-up" action={signUp} />
        )}
        <p className="mt-6 text-sm text-muted">
          Already have an account?{" "}
          <Link href="/auth/sign-in" className="font-semibold text-ocean-700">Sign in</Link>
        </p>
      </section>
    </main>
  );
}
