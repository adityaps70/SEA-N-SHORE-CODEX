"use client";

import Link from "next/link";
import { useActionState, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { PasswordField } from "@/features/auth/components/password-field";
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
  /** Rendered between the title and the form, e.g. the phone-only Google / mobile buttons. */
  lead?: ReactNode;
};

/** Phone-only line under the title (desktop shows the title alone, as before). */
const phoneSubtitles: Partial<Record<AuthMode, string>> = {
  "sign-in": "Stay updated on your maritime career",
  "sign-up": "Join the maritime professional network. It’s free.",
};

const labels: Record<AuthMode, { title: string; submit: string }> = {
  "sign-in": { title: "Welcome back", submit: "Sign in" },
  "sign-up": { title: "Build your professional profile", submit: "Create account" },
  "forgot-password": { title: "Reset your password", submit: "Send reset code" },
  "update-password": { title: "Choose a new password", submit: "Update password" },
  "confirm-sign-up": { title: "Confirm your email", submit: "Confirm account" },
};

export function AuthForm({ mode, action, flow, initialEmail, lead }: AuthFormProps) {
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
      {phoneSubtitles[mode] ? <p className="mt-2 text-base text-muted md:hidden">{phoneSubtitles[mode]}</p> : null}
      {lead}
      <form action={formAction} onSubmit={validateConfirmation} className="mt-7 grid gap-5 max-md:mt-5 max-md:gap-4" noValidate>
        {flow && <input type="hidden" name="mode" value={flow} />}
        {showName && <Field label="Full name" name="fullName" autoComplete="name" required />}
        {showEmail && (
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            defaultValue={initialEmail}
            required
          />
        )}
        {showCode && <Field label="Confirmation code" name="code" inputMode="numeric" autoComplete="one-time-code" required />}
        {showPassword && (
          <PasswordField
            label="Password"
            name="password"
            autoComplete={mode === "update-password" ? "new-password" : mode === "sign-in" ? "current-password" : "new-password"}
            hint={mode === "sign-up" || mode === "update-password" ? "Use at least 12 characters." : undefined}
            required
            minLength={12}
          />
        )}
        {showPasswordConfirmation && (
          <PasswordField
            label="Confirm password"
            name="passwordConfirmation"
            autoComplete="new-password"
            error={confirmationError}
            required
            minLength={12}
          />
        )}
        {mode === "sign-in" && (
          <p className="-mt-1 text-sm md:hidden">
            <Link href="/auth/forgot-password" className="inline-flex min-h-11 items-center font-semibold text-ocean-700 underline-offset-2 hover:text-navy-950 hover:underline">Forgot password?</Link>
          </p>
        )}
        {state.error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{state.error}</p>}
        {state.message && <p role="status" className="rounded-lg bg-mist-50 px-4 py-3 text-sm text-ocean-700">{state.message}</p>}
        <Button type="submit" disabled={pending} className="max-md:min-h-13 max-md:rounded-full max-md:text-base">{pending ? "Please wait…" : copy.submit}</Button>
      </form>
    </div>
  );
}
