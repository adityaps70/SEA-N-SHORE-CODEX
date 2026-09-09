import { ArrowUpRight, BriefcaseBusiness, Handshake, Ship, Waypoints } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LandingSectionHeading } from './landing-section-heading'

const opportunities = [
  ['Sea careers', 'Stay visible to maritime opportunities without reducing your professional identity to a vacancy application.', Ship],
  ['Shore transitions', 'Make sea-service experience understandable when you are moving into superintendent, training, crewing or management roles.', Waypoints],
  ['Professional collaborations', 'Build relationships around consulting, training, technical support and shared industry interests.', Handshake],
  ['Talent discovery', 'Help recruiters and maritime companies understand the people behind the role before starting a conversation.', BriefcaseBusiness],
] as const

export function OpportunitiesShowcase() {
  return (
    <section className="py-16 sm:py-20" aria-labelledby="opportunities-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <LandingSectionHeading id="opportunities-title" eyebrow="Career and professional growth" title="Opportunity should follow your maritime experience." body="The ecosystem creates professional visibility across sea careers, shore transitions, collaborations and talent discovery without pretending an unfinished jobs marketplace is already live." />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {opportunities.map(([title, copy, Icon]) => <Card key={title} className="border border-mist-100 p-5 shadow-none"><div className="flex items-center justify-between"><Icon aria-hidden="true" className="size-5 text-teal-500" /><ArrowUpRight aria-hidden="true" className="size-4 text-mist-300" /></div><h3 className="mt-5 text-lg font-semibold text-navy-950">{title}</h3><p className="mt-3 text-sm leading-6 text-muted">{copy}</p></Card>)}
        </div>
      </div>
    </section>
  )
}
