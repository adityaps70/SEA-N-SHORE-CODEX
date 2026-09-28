import type { Metadata } from 'next'
import { AuthShell } from "@/features/auth/components/auth-shell";
import { confirmPhoneOtp, requestPhoneOtp } from "@/features/auth/actions";
import { PhoneAuthForm } from "@/features/auth/components/phone-auth-form";

export const metadata: Metadata = { title: 'Sign in with phone' }

export default async function PhoneAuthPage({
  searchParams,
}: {
  searchParams: Promise<{ intent?: string; step?: string }>;
}) {
  const params = await searchParams;
  const intent = params.intent === "sign-up" ? "sign-up" : "sign-in";
  const step = params.step === "confirm" ? "confirm" : "request";

  return (
    <AuthShell>
      <div className="mt-7">
        <PhoneAuthForm
          intent={intent}
          step={step}
          requestAction={requestPhoneOtp}
          confirmAction={confirmPhoneOtp}
        />
      </div>
    </AuthShell>
  );
}
