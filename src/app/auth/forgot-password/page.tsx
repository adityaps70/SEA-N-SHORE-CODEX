import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthForm } from "@/features/auth/components/auth-form";
import { requestPasswordReset } from "@/features/auth/actions";

export default function ForgotPasswordPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        <p className="mt-4 leading-7 text-muted">
          We&apos;ll send a secure recovery link if an account exists for this
          address.
        </p>
        <AuthForm mode="forgot-password" action={requestPasswordReset} />
        <p className="mt-6 text-sm">
          <Link href="/auth/sign-in" className="font-semibold text-ocean-700">
            Back to sign in
          </Link>
        </p>
      </section>
    </main>
  );
}
