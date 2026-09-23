"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import type { PhoneAuthActionState } from "@/features/auth/phone-auth-actions";

type PhoneAuthAction = (
  state: PhoneAuthActionState,
  formData: FormData,
) => Promise<PhoneAuthActionState>;

type PhoneAuthFormProps = {
  intent: "sign-in" | "sign-up";
  step: "request" | "confirm";
  requestAction: PhoneAuthAction;
  confirmAction: PhoneAuthAction;
};

export function PhoneAuthForm({
  intent,
  step,
  requestAction,
  confirmAction,
}: PhoneAuthFormProps) {
  const action = step === "confirm" ? confirmAction : requestAction;
  const [state, formAction, pending] = useActionState(action, {});
  const isSignUp = intent === "sign-up";

  return (
    <div>
      <h1 className="text-3xl font-semibold tracking-[-0.04em] text-navy-950">
        {step === "confirm"
          ? "Verify your mobile"
          : isSignUp
            ? "Create account with mobile"
            : "Sign in with mobile"}
      </h1>

      <p className="mt-3 text-sm leading-6 text-muted">
        {step === "confirm"
          ? "Enter the 6-digit code sent to your mobile number."
          : "Use your mobile number with country code. We will send a one-time verification code."}
      </p>

      <form action={formAction} className="mt-7 grid gap-5" noValidate>
        {step === "request" ? (
          <>
            <input type="hidden" name="intent" value={intent} />
            {isSignUp && (
              <Field
                label="Full name"
                name="fullName"
                autoComplete="name"
                required
              />
            )}
            <Field
              label="Mobile number"
              name="phoneNumber"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="+919876543210"
              hint="Include country code, for example +91 for India."
              required
            />
          </>
        ) : (
          <Field
            label="Verification code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            minLength={6}
            maxLength={6}
            placeholder="123456"
            required
          />
        )}

        {state.error && (
          <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
            {state.error}
          </p>
        )}
        {state.message && (
          <p role="status" className="rounded-lg bg-mist-50 px-4 py-3 text-sm text-ocean-700">
            {state.message}
          </p>
        )}

        <Button type="submit" disabled={pending}>
          {pending
            ? "Please wait…"
            : step === "confirm"
              ? "Verify and continue"
              : "Send verification code"}
        </Button>
      </form>

      <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-sm">
        {step === "confirm" && (
          <Link
            href={`/auth/phone?intent=${intent}`}
            className="font-semibold text-ocean-700"
          >
            Use a different number
          </Link>
        )}
        <Link href={intent === "sign-up" ? "/auth/sign-up" : "/auth/sign-in"} className="font-semibold text-ocean-700">
          Use email instead
        </Link>
      </div>
    </div>
  );
}
