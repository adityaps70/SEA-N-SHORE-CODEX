import { Wordmark } from "@/components/brand/wordmark";
import { AuthForm } from "@/features/auth/components/auth-form";
import { updatePassword } from "@/features/auth/actions";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; email?: string }>;
}) {
  const params = await searchParams;
  const flow = params.mode === "confirm-reset" ? "confirm-reset" : "new-password";

  return (
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        <p className="mt-4 leading-7 text-muted">
          {flow === "confirm-reset"
            ? "Enter the recovery code and choose a new password."
            : "Choose a new password to finish signing in."}
        </p>
        <AuthForm
          mode="update-password"
          action={updatePassword}
          flow={flow}
          initialEmail={params.email}
        />
      </section>
    </main>
  );
}
