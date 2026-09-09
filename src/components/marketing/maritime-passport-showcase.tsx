import { BadgeCheck, FileDown, MapPinned, QrCode, Ship, TimerReset } from 'lucide-react'
import { LandingSectionHeading } from './landing-section-heading'

const details = [
  'Rank / role', 'Sea service', 'Vessel types', 'Cargo / engine experience', 'Trading areas', 'Onboard / Ashore', 'CoC & certificates', 'Career timeline', 'QR profile', 'Downloadable CV',
]

export function MaritimePassportShowcase() {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="passport-showcase-title">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[.95fr_1.05fr] lg:items-center">
        <div>
          <LandingSectionHeading id="passport-showcase-title" eyebrow="Maritime Passport" title="Your maritime career. One professional identity." body="Give recruiters, colleagues and industry connections a clearer view of the experience that actually matters at sea and ashore." />
          <div className="mt-7 grid gap-2 sm:grid-cols-2">
            {details.map((item) => <div key={item} className="flex items-center gap-2 rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm font-semibold text-navy-900"><BadgeCheck aria-hidden="true" className="size-4 text-teal-500" />{item}</div>)}
          </div>
        </div>
        <div className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
          <div className="bg-[linear-gradient(135deg,#062f4d,#0b6b86)] p-6 text-white">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.15em] text-teal-300">Sea N Shore Maritime Passport</p>
                <h3 className="mt-3 text-2xl font-semibold">Professional maritime identity</h3>
                <p className="mt-2 text-sm text-white/70">Built around real career context, not a generic résumé.</p>
              </div>
              <Ship aria-hidden="true" className="size-8 text-teal-300" />
            </div>
          </div>
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <div className="rounded-2xl bg-mist-50 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Career snapshot</p><p className="mt-2 font-semibold text-navy-950">Rank, sea service, vessels and trading exposure</p></div>
            <div className="rounded-2xl border border-mist-100 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Availability</p><p className="mt-2 flex items-center gap-2 font-semibold text-navy-950"><TimerReset aria-hidden="true" className="size-4 text-teal-500" />Onboard / Ashore</p></div>
            <div className="rounded-2xl border border-mist-100 p-4"><p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Experience</p><p className="mt-2 flex items-center gap-2 font-semibold text-navy-950"><MapPinned aria-hidden="true" className="size-4 text-teal-500" />Cargo, engine & trading areas</p></div>
            <div className="rounded-2xl bg-navy-950 p-4 text-white"><p className="text-xs font-semibold uppercase tracking-[.12em] text-teal-300">Share anywhere</p><div className="mt-3 flex gap-4 text-sm"><span className="inline-flex items-center gap-1.5"><QrCode aria-hidden="true" className="size-4" />QR</span><span className="inline-flex items-center gap-1.5"><FileDown aria-hidden="true" className="size-4" />CV</span></div></div>
          </div>
        </div>
      </div>
    </section>
  )
}
