import Link from 'next/link'
import { ArrowRight, Anchor } from 'lucide-react'

type Action = { href: string; label: string }

export function FinalEcosystemCta({ primary, secondary }: { primary: Action; secondary: Action }) {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="final-ecosystem-cta-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="overflow-hidden rounded-[2rem] bg-[linear-gradient(135deg,#062f4d,#0b6b86_62%,#0f8b8d)] px-6 py-10 text-white sm:px-10 sm:py-12 lg:flex lg:items-center lg:justify-between lg:gap-10">
          <div className="max-w-3xl">
            <p className="flex items-center gap-2 text-sm font-semibold uppercase tracking-[.14em] text-teal-300"><Anchor aria-hidden="true" className="size-4" />Built for the whole career</p>
            <h2 id="final-ecosystem-cta-title" className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Your maritime network should move with your career.</h2>
            <p className="mt-4 text-base leading-7 text-white/70">Whether you are onboard today, ashore tomorrow, hiring, learning or sharing experience, your professional identity and maritime network should stay with you.</p>
          </div>
          <div className="mt-7 flex shrink-0 flex-col gap-3 sm:flex-row lg:mt-0 lg:flex-col xl:flex-row">
            <Link href={primary.href} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-white px-5 text-sm font-semibold text-navy-950 transition hover:bg-mist-50">{primary.label}<ArrowRight aria-hidden="true" className="size-4" /></Link>
            <Link href={secondary.href} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-white/30 px-5 text-sm font-semibold text-white transition hover:bg-white/10">{secondary.label}</Link>
          </div>
        </div>
      </div>
    </section>
  )
}
