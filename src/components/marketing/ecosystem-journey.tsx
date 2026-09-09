import { BookOpen, BriefcaseBusiness, Network, UserRoundCheck } from 'lucide-react'
import { RouteLine } from '@/components/brand/route-line'
import { LandingSectionHeading } from './landing-section-heading'

const stages = [
  ['Maritime Passport', 'Build a professional identity that carries your maritime experience.', UserRoundCheck],
  ['Network', 'Stay connected with maritime people across sea and shore.', Network],
  ['Knowledge', 'Share and learn from practical professional experience.', BookOpen],
  ['Opportunity', 'Turn visibility and relationships into career and professional possibilities.', BriefcaseBusiness],
] as const

export function EcosystemJourney() {
  return (
    <section className="border-y border-mist-100 bg-white py-16 sm:py-20" aria-labelledby="ecosystem-journey-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <LandingSectionHeading id="ecosystem-journey-title" eyebrow="One connected journey" title="Connect. Learn. Share. Grow." body="Sea N Shore is designed so your identity, network and knowledge reinforce each other throughout a maritime career." align="center" />
        <div className="relative mt-10 grid gap-4 md:grid-cols-4">
          <RouteLine className="absolute left-[12%] right-[12%] top-7 hidden h-7 w-[76%] text-teal-400 md:block" />
          {stages.map(([title, copy, Icon], index) => <div key={title} className="relative rounded-2xl border border-mist-100 bg-white p-5 text-center"><div className="mx-auto grid size-14 place-items-center rounded-2xl bg-ocean-50"><Icon aria-hidden="true" className="size-6 text-ocean-700" /></div><p className="mt-4 text-xs font-semibold uppercase tracking-[.13em] text-teal-600">0{index + 1}</p><h3 className="mt-1 text-lg font-semibold text-navy-950">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{copy}</p></div>)}
        </div>
      </div>
    </section>
  )
}
