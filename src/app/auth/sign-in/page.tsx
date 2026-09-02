import Link from "next/link";
import { Wordmark } from "@/components/brand/wordmark";
import { AuthForm } from "@/features/auth/components/auth-form";
import { signIn, signInWithGoogle } from "@/features/auth/actions";

export default function SignInPage() {
  return (
    <AuthPage>
      <AuthForm
        mode="sign-in"
        action={signIn}
        googleAction={signInWithGoogle}
      />
      <p className="mt-6 text-sm text-muted">
        New to Sea N Shore?{" "}
        <Link href="/auth/sign-up" className="font-semibold text-ocean-700">
          Create your profile
        </Link>
      </p>
      <p className="mt-3 text-sm">
        <Link
          href="/auth/forgot-password"
          className="font-semibold text-ocean-700"
        >
          Forgot password?
        </Link>
      </p>
    </AuthPage>
  );
}

function AuthPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        {children}
      </section>
    </main>
  );
}
