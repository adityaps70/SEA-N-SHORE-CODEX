import { BarChart3, MessageSquareText, Wrench } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LandingSectionHeading } from './landing-section-heading'

const examples = [
  ['Bridge teamwork', 'What is the most overlooked bridge-team behaviour during high-workload pilotage?', MessageSquareText],
  ['Engineering practice', 'Three practical checks before troubleshooting repeated purifier alarms onboard.', Wrench],
  ['Industry poll', 'Which SIRE 2.0 competency is hardest to assess objectively onboard?', BarChart3],
] as const

export function MaritimeFeedShowcase() {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="feed-showcase-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <LandingSectionHeading id="feed-showcase-title" eyebrow="Professional feed" title="Professional conversations built around the work" body="Sea N Shore gives maritime professionals a place to exchange practical knowledge, ask better questions and keep useful experience circulating across the industry." />
        <div className="mt-9 grid gap-4 lg:grid-cols-3">
          {examples.map(([label, copy, Icon]) => <Card key={label} className="border border-mist-100 p-5 shadow-none"><div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-[.13em] text-ocean-700">Example discussion</span><Icon aria-hidden="true" className="size-5 text-teal-500" /></div><p className="mt-5 text-sm font-semibold uppercase tracking-[.12em] text-muted">{label}</p><p className="mt-3 text-lg font-semibold leading-7 text-navy-950">{copy}</p></Card>)}
        </div>
      </div>
    </section>
  )
}
