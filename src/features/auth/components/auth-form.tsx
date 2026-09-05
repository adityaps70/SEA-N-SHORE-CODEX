"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { AuthActionState } from "@/features/auth/actions";

type AuthAction = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;
type AuthMode = "sign-in" | "sign-up" | "forgot-password" | "update-password" | "confirm-sign-up";
type PasswordFlow = "new-password" | "confirm-reset";

type AuthFormProps = {
  mode: AuthMode;
  action: AuthAction;
  flow?: PasswordFlow;
  initialEmail?: string;
};

const labels: Record<AuthMode, { title: string; submit: string }> = {
  "sign-in": { title: "Welcome back", submit: "Sign in" },
  "sign-up": { title: "Build your professional profile", submit: "Create account" },
  "forgot-password": { title: "Reset your password", submit: "Send reset code" },
  "update-password": { title: "Choose a new password", submit: "Update password" },
  "confirm-sign-up": { title: "Confirm your email", submit: "Confirm account" },
};

export function AuthForm({ mode, action, flow, initialEmail }: AuthFormProps) {
  const [state, formAction, pending] = useActionState(action, {});
  const [confirmationError, setConfirmationError] = useState<string>();
  const showName = mode === "sign-up";
  const showEmail = mode !== "update-password" || flow === "confirm-reset";
  const showCode = mode === "confirm-sign-up" || (mode === "update-password" && flow === "confirm-reset");
  const showPassword = mode === "sign-in" || mode === "sign-up" || mode === "update-password";
  const showPasswordConfirmation = mode === "update-password";
  const copy = labels[mode];

  function validateConfirmation(event: React.FormEvent<HTMLFormElement>) {
    if (!showPasswordConfirmation) return;
    const data = new FormData(event.currentTarget);
    if (data.get("password") !== data.get("passwordConfirmation")) {
      event.preventDefault();
      setConfirmationError("Passwords do not match.");
      return;
    }
    setConfirmationError(undefined);
  }

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-[-0.04em] text-navy-950">{copy.title}</h1>
      <form action={formAction} onSubmit={validateConfirmation} className="mt-7 grid gap-5" noValidate>
        {flow && <input type="hidden" name="mode" value={flow} />}
        {showName && <Field label="Full name" name="fullName" autoComplete="name" required />}
        {showEmail && (
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            defaultValue={initialEmail}
            required
          />
        )}
        {showCode && <Field label="Confirmation code" name="code" inputMode="numeric" autoComplete="one-time-code" required />}
        {showPassword && (
          <Field
            label="Password"
            name="password"
            type="password"
            autoComplete={mode === "update-password" ? "new-password" : mode === "sign-in" ? "current-password" : "new-password"}
            hint={mode === "sign-up" || mode === "update-password" ? "Use at least 12 characters." : undefined}
            required
            minLength={12}
          />
        )}
        {showPasswordConfirmation && (
          <Field
            label="Confirm password"
            name="passwordConfirmation"
            type="password"
            autoComplete="new-password"
            error={confirmationError}
            required
            minLength={12}
          />
        )}
        {state.error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
        {state.message && <p role="status" className="rounded-lg bg-mist-50 px-4 py-3 text-sm text-ocean-700">{state.message}</p>}
        <Button type="submit" disabled={pending}>{pending ? "Please wait…" : copy.submit}</Button>
      </form>
    </div>
  );
}
