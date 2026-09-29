import type { Metadata } from 'next'
import Link from "next/link";
import { AuthShell } from "@/features/auth/components/auth-shell";
import { AuthForm } from "@/features/auth/components/auth-form";
import { requestPasswordReset } from "@/features/auth/actions";

export const metadata: Metadata = { title: 'Forgot password' }

export default function ForgotPasswordPage() {
  return (
    <AuthShell>
      <p className="mt-4 leading-7 text-muted">
        We&apos;ll send a secure recovery code if an account exists for this address.
      </p>
      <AuthForm mode="forgot-password" action={requestPasswordReset} />
      <p className="mt-6 text-sm">
        <Link href="/auth/sign-in" className="font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline max-md:inline-flex max-md:min-h-11 max-md:items-center max-md:text-base">Back to sign in</Link>
      </p>
    </AuthShell>
  );
}
