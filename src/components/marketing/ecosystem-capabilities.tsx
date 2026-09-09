import { BadgeCheck, BookOpen, BriefcaseBusiness, Compass, MessagesSquare, UsersRound } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { LandingSectionHeading } from './landing-section-heading'

const capabilities = [
  ['Maritime Passport', 'Build one professional identity around rank, sea service, vessel exposure, career history and credentials.', BadgeCheck],
  ['Professional Network', 'Discover maritime professionals and stay connected across contracts, companies and sea-to-shore moves.', UsersRound],
  ['Maritime Feed', 'Share technical lessons, practical experience, polls and professional discussion with the industry.', MessagesSquare],
  ['Career Visibility', 'Show your role, experience and Onboard or Ashore status so the right people understand your current context.', Compass],
  ['Knowledge & Learning', 'Exchange useful maritime knowledge today while structured learning grows as part of the wider ecosystem.', BookOpen],
  ['Opportunities', 'Create visibility for sea careers, shore transitions, professional collaborations and talent discovery.', BriefcaseBusiness],
] as const

export function EcosystemCapabilities() {
  return (
    <section className="bg-white py-16 sm:py-20" aria-labelledby="ecosystem-capabilities-title">
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
        <LandingSectionHeading id="ecosystem-capabilities-title" eyebrow="One maritime ecosystem" title="Everything maritime professionals need to stay visible, connected and useful." body="Sea N Shore brings professional identity, people, knowledge and opportunity into one consistent maritime network." />
        <div className="mt-9 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map(([title, detail, Icon]) => (
            <Card key={title} className="border border-mist-100 p-6 shadow-none">
              <div className="grid size-11 place-items-center rounded-xl bg-ocean-50"><Icon aria-hidden="true" className="size-5 text-ocean-700" /></div>
              <h3 className="mt-5 text-xl font-semibold text-navy-950">{title}</h3>
              <p className="mt-3 leading-7 text-muted">{detail}</p>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
