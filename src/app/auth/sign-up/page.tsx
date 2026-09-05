import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthForm } from "@/features/auth/components/auth-form";
import { confirmSignUp, signUp } from "@/features/auth/actions";

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ confirm?: string; email?: string }> }) {
  const params = await searchParams;
  const confirming = params.confirm === "1";

  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        {confirming ? (
          <>
            <p className="mt-4 leading-7 text-muted">Enter the confirmation code sent to your email address.</p>
            <AuthForm mode="confirm-sign-up" action={confirmSignUp} initialEmail={params.email} />
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
