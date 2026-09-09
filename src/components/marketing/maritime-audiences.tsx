import { Building2, ShipWheel, UserRoundSearch, UsersRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LandingSectionHeading } from './landing-section-heading'

const audiences = [
  ['Seafarers', 'Build a maritime identity that moves with you between vessels, contracts and companies while keeping your network and professional knowledge in one place.', ShipWheel],
  ['Shore Professionals', 'Stay visible across technical, marine, crewing, training and management roles while connecting with the wider maritime industry.', UsersRound],
  ['Recruiters & Crewing Teams', 'Understand a professional’s rank, sea service, vessel exposure and current career context before starting a conversation.', UserRoundSearch],
  ['Maritime Companies', 'Build professional visibility, discover maritime talent and participate in industry conversations without turning the platform into a generic job board.', Building2],
] as const

export function MaritimeAudiences() {
  return (
    <section className="border-y border-mist-100 bg-white py-16 sm:py-20" aria-labelledby="maritime-audiences-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <LandingSectionHeading eyebrow="Across the industry" title="Built for every side of maritime" body="One network should make sense whether you are sailing, transitioning ashore, hiring, training or leading maritime operations." align="center" />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {audiences.map(([title, body, Icon]) => <Card key={title} className="border border-mist-100 p-5 shadow-none"><Icon aria-hidden="true" className="size-6 text-teal-500" /><h3 className="mt-5 text-lg font-semibold text-navy-950">{title}</h3><p className="mt-3 text-sm leading-6 text-muted">{body}</p></Card>)}
        </div>
      </div>
    </section>
  )
}
