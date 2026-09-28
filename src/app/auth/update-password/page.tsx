import type { Metadata } from 'next'
import { AuthShell } from "@/features/auth/components/auth-shell";
import { AuthForm } from "@/features/auth/components/auth-form";
import { updatePassword } from "@/features/auth/actions";

export const metadata: Metadata = { title: 'Update password' }

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string; email?: string }>;
}) {
  const params = await searchParams;
  const flow = params.mode === "confirm-reset" ? "confirm-reset" : "new-password";

  return (
    <AuthShell>
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
    </AuthShell>
  );
}
