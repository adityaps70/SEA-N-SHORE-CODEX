import { Link2, Network, ShipWheel, Waypoints } from 'lucide-react'
import { LandingSectionHeading } from './landing-section-heading'

const problems = [
  ['Fragmented identity', 'Maritime careers move across vessels, companies and contracts, but professional identity rarely moves with the person.', ShipWheel],
  ['Scattered knowledge', 'Useful technical and operational experience gets buried in private chats, documents and disconnected groups.', Link2],
  ['Sea-to-shore friction', 'Strong sea-going experience is often difficult to translate when professionals move into shore roles.', Waypoints],
  ['Relationship-heavy discovery', 'Recruitment and professional discovery still depend heavily on who already knows whom.', Network],
] as const

export function WhySeaNShore() {
  return (
    <section className="bg-navy-950 py-16 text-white sm:py-20" aria-labelledby="why-sea-n-shore-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <div className="max-w-3xl">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-300">Why Sea N Shore exists</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-[-0.035em] sm:text-4xl">Maritime careers should not become fragmented every time the vessel, company or role changes.</h2>
          <p className="mt-4 text-base leading-7 text-white/70 sm:text-lg sm:leading-8">Sea N Shore connects identity, people, knowledge and opportunity so professional value stays visible across the whole maritime career.</p>
        </div>
        <div className="mt-9 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {problems.map(([title, copy, Icon]) => <div key={title} className="rounded-2xl border border-white/10 bg-white/5 p-5"><Icon aria-hidden="true" className="size-5 text-teal-300" /><h3 className="mt-4 font-semibold">{title}</h3><p className="mt-2 text-sm leading-6 text-white/60">{copy}</p></div>)}
        </div>
      </div>
    </section>
  )
}
