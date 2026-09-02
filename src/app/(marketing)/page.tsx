import Link from "next/link";
import {
  ArrowRight,
  BadgeCheck,
  BookOpen,
  BriefcaseBusiness,
  UsersRound,
} from "lucide-react";
import { RouteLine } from "@/components/brand/route-line";
import { Card } from "@/components/ui/card";

const pillars = [
  {
    title: "Network",
    detail: "Meet verified people who understand the work behind the voyage.",
    Icon: UsersRound,
  },
  {
    title: "Careers",
    detail: "Find roles and opportunities built for maritime professionals.",
    Icon: BriefcaseBusiness,
  },
  {
    title: "Knowledge",
    detail: "Join the daily exchanges that make the industry sharper.",
    Icon: BookOpen,
  },
  {
    title: "Trust",
    detail: "Build a professional identity grounded in real experience.",
    Icon: BadgeCheck,
  },
];

export default function Home() {
  return (
    <main id="main-content">
      <section className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:py-24">
        <div className="max-w-2xl">
          <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-ocean-700">
            <RouteLine /> The professional maritime network
          </p>
          <h1 className="mt-7 text-5xl font-semibold tracking-[-0.055em] text-navy-950 sm:text-6xl lg:text-7xl">
            Where maritime careers and knowledge move forward.
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-muted">
            Create a verified professional identity, take part in daily industry
            discussion, and discover opportunities that move with the maritime
            world.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/auth/sign-up"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white hover:bg-navy-900"
            >
              Create your professional profile{" "}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link
              href="/community"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-navy-900 bg-white px-5 text-sm font-semibold text-navy-900 hover:bg-mist-50"
            >
              Explore the community
            </Link>
          </div>
        </div>
        <div
          aria-label="Sea N Shore product preview"
          className="relative mx-auto w-full max-w-xl"
        >
          <RouteLine className="absolute -top-5 right-4 h-10 w-28 text-teal-500" />
          <Card className="relative overflow-hidden border border-mist-100 p-5 sm:p-7">
            <div className="flex items-center justify-between border-b border-mist-100 pb-4">
              <span className="text-sm font-semibold text-navy-900">
                Sea N Shore
              </span>
              <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-medium text-ocean-700">
                Verified network
              </span>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-[.8fr_1.2fr]">
              <div className="rounded-xl bg-navy-950 p-5 text-white">
                <p className="text-xs font-semibold uppercase tracking-[.16em] text-teal-500">
                  Voyage brief
                </p>
                <p className="mt-7 text-xl font-semibold tracking-tight">
                  A clearer course for your next move.
                </p>
                <div className="mt-8 h-px w-full bg-white/20" />
                <p className="mt-3 text-sm text-white/70">
                  People, knowledge, opportunity.
                </p>
              </div>
              <div className="space-y-3">
                <div className="rounded-xl border border-mist-100 p-4">
                  <p className="text-xs font-semibold text-ocean-700">
                    TODAY&apos;S DISCUSSION
                  </p>
                  <p className="mt-2 font-semibold text-navy-900">
                    How ports are building crews for a new era.
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    12 maritime professionals contributing
                  </p>
                </div>
                <div className="rounded-xl bg-mist-50 p-4">
                  <p className="text-xs font-semibold text-ocean-700">
                    OPPORTUNITY
                  </p>
                  <p className="mt-2 font-semibold text-navy-900">
                    Fleet operations lead
                  </p>
                  <p className="mt-3 text-sm text-muted">
                    Singapore · Full time
                  </p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </section>
      <section className="border-y border-mist-100 bg-white">
        <div className="mx-auto w-full max-w-7xl px-4 py-16 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ocean-700">
            Built for the people moving maritime forward
          </p>
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {pillars.map(({ title, detail, Icon }) => (
              <Card
                key={title}
                className="border border-mist-100 p-6 shadow-none"
              >
                <Icon aria-hidden="true" className="size-6 text-teal-500" />
                <h2 className="mt-6 text-xl font-semibold tracking-tight text-navy-950">
                  {title}
                </h2>
                <p className="mt-3 leading-7 text-muted">{detail}</p>
              </Card>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
