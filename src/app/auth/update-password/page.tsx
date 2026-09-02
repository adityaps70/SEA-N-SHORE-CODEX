import { Wordmark } from "@/components/brand/wordmark";
import { AuthForm } from "@/features/auth/components/auth-form";
import { updatePassword } from "@/features/auth/actions";
import { requireUser } from "@/features/auth/queries";

export default async function UpdatePasswordPage() {
  await requireUser();
  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        <p className="mt-4 leading-7 text-muted">
          Set a new password for your account.
        </p>
        <AuthForm mode="update-password" action={updatePassword} />
      </section>
    </main>
  );
}
