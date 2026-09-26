import type { Metadata } from 'next'
import { Wordmark } from "@/components/brand/wordmark";
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
    <main className="grid min-h-screen place-items-center bg-mist-50 px-4 py-10">
      <section className="w-full max-w-md rounded-[var(--radius-card)] bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <Wordmark />
        <div className="mt-7">
          <PhoneAuthForm
            intent={intent}
            step={step}
            requestAction={requestPhoneOtp}
            confirmAction={confirmPhoneOtp}
          />
        </div>
      </section>
    </main>
  );
}
