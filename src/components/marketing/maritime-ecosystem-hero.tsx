import Link from 'next/link'
import { Anchor, ArrowRight, BadgeCheck, BookOpen, Network, Ship, Waves } from 'lucide-react'
import { Card } from '@/components/ui/card'

type Action = { href: string; label: string }

export function MaritimeEcosystemHero({ primary, secondary }: { primary: Action; secondary: Action }) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid w-full max-w-7xl gap-12 px-4 py-14 sm:px-6 sm:py-18 lg:grid-cols-[1.02fr_.98fr] lg:items-center lg:py-24">
        <div className="max-w-3xl">
          <p className="flex items-center gap-3 text-sm font-semibold uppercase tracking-[0.16em] text-ocean-700">
            <span aria-hidden="true" className="h-6 w-16" /> Built for maritime, end to end
          </p>
          <h1 className="mt-7 text-5xl font-semibold tracking-[-0.055em] text-navy-950 sm:text-6xl lg:text-7xl">
            The all-in-one professional ecosystem for the maritime industry.
          </h1>
          <p className="mt-7 max-w-2xl text-lg leading-8 text-muted">
            Build your Maritime Passport, stay connected across sea and shore, exchange practical industry knowledge and make your experience visible to the right people in one professional network.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link href={primary.href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition hover:bg-navy-900">
              {primary.label}<ArrowRight aria-hidden="true" className="size-4" />
            </Link>
            <Link href={secondary.href} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-navy-900 bg-white px-5 text-sm font-semibold text-navy-900 transition hover:bg-mist-50">
              {secondary.label}
            </Link>
          </div>
          <div className="mt-8 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-muted">
            <span className="inline-flex items-center gap-2"><Ship aria-hidden="true" className="size-4 text-teal-500" />Sea + shore identity</span>
            <span className="inline-flex items-center gap-2"><Network aria-hidden="true" className="size-4 text-teal-500" />Professional network</span>
            <span className="inline-flex items-center gap-2"><BookOpen aria-hidden="true" className="size-4 text-teal-500" />Maritime knowledge</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-xl" aria-label="Sea N Shore ecosystem interface">
          <Card className="overflow-hidden border border-mist-100 bg-white p-0 shadow-[var(--shadow-card)]">
            <div className="bg-navy-950 p-5 text-white sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[.15em] text-teal-400">Maritime Passport</p>
                  <p className="mt-2 text-xl font-semibold">Master Mariner</p>
                  <p className="mt-1 text-sm text-white/65">Tanker operations · Worldwide trading</p>
                </div>
                <div className="grid size-12 place-items-center rounded-2xl bg-white/10"><Anchor aria-hidden="true" className="size-6 text-teal-300" /></div>
              </div>
              <div className="mt-5 grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-white/8 p-3"><span className="block text-white/55">Status</span><strong className="mt-1 block text-sm">Onboard / Ashore</strong></div>
                <div className="rounded-xl bg-white/8 p-3"><span className="block text-white/55">Sea service</span><strong className="mt-1 block text-sm">18 years</strong></div>
                <div className="rounded-xl bg-white/8 p-3"><span className="block text-white/55">CoC</span><strong className="mt-1 block text-sm">Wallet ready</strong></div>
              </div>
            </div>
            <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
              <div className="rounded-2xl border border-mist-100 p-4">
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">Professional feed</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-navy-950">Share technical lessons, practical experience and industry discussion.</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted"><Waves aria-hidden="true" className="size-4 text-teal-500" />Posts · polls · comments</div>
              </div>
              <div className="rounded-2xl bg-mist-50 p-4">
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">Professional network</p>
                <p className="mt-2 text-sm font-semibold leading-6 text-navy-950">Find maritime people by role, experience and career context.</p>
                <div className="mt-4 flex items-center gap-2 text-xs text-muted"><BadgeCheck aria-hidden="true" className="size-4 text-teal-500" />Sea to shore visibility</div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  )
}
