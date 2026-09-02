import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import {
  getOwnProfileOnboardingState,
  requireUser,
} from "@/features/auth/queries";

export default async function HomePage() {
  const user = await requireUser();
  const onboardingComplete = await getOwnProfileOnboardingState(user.id);
  const name =
    user.user_metadata.full_name || user.email || "Maritime professional";
  return (
    <section className="max-w-3xl py-8 sm:py-14">
      <p className="text-sm font-semibold uppercase tracking-[.16em] text-ocean-700">
        Your Sea N Shore
      </p>
      <h1 className="mt-4 text-4xl font-semibold tracking-[-.04em] text-navy-950">
        Welcome, {name}.
      </h1>
      <Card className="mt-8 border border-mist-100 p-6 sm:p-8">
        {onboardingComplete ? (
          <>
            <h2 className="text-2xl font-semibold tracking-tight text-navy-950">
              Your professional profile is complete.
            </h2>
            <p className="mt-3 max-w-xl leading-7 text-muted">
              Your profile details are ready to support the conversations and opportunities ahead.
            </p>
            <Link
              href="/profile"
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
            >
              View my professional profile
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-semibold tracking-tight text-navy-950">
              Your professional profile is waiting.
            </h2>
            <p className="mt-3 max-w-xl leading-7 text-muted">
              Finish your details to help the maritime community understand your
              experience, expertise, and next destination.
            </p>
            <Link
              href="/onboarding"
              className="mt-6 inline-flex min-h-12 items-center gap-2 rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white hover:bg-navy-900"
            >
              Continue to onboarding{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </>
        )}
      </Card>
    </section>
  );
}
