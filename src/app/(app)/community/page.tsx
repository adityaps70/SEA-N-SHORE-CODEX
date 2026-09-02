import { BadgeQuestionMark, BookOpenCheck, MessagesSquare, Radio, ShieldCheck, UsersRound } from 'lucide-react'
import { ProductSurface } from '@/components/product/product-surface'

const items = [
  {
    title: 'Tanker Professionals',
    description: 'Operational discussion around tanker practice, vetting, SIRE 2.0, cargo operations and lessons from the fleet.',
    meta: 'Specialist group',
    icon: ShieldCheck,
  },
  {
    title: 'Masters & Senior Officers',
    description: 'A peer space for command, leadership, regulation, safety culture and career decisions at senior level.',
    meta: 'Leadership',
    icon: UsersRound,
  },
  {
    title: 'Marine Engineers',
    description: 'Technical conversations spanning machinery, maintenance, troubleshooting, energy efficiency and engineering careers.',
    meta: 'Engineering',
    icon: MessagesSquare,
  },
  {
    title: 'Cadets Community',
    description: 'Practical guidance from experienced professionals for training, examinations, first contracts and early-career confidence.',
    meta: 'Early career',
    icon: BookOpenCheck,
  },
  {
    title: 'Ask the community',
    description: 'Turn professional questions into structured discussions where useful answers can build reputation over time.',
    meta: 'Knowledge exchange',
    icon: BadgeQuestionMark,
  },
  {
    title: 'Events inside groups',
    description: 'Connect announcements, expert sessions and live discussions directly to the communities they matter to.',
    meta: 'Live community',
    icon: Radio,
  },
]

export default function CommunityPage() {
  return (
    <ProductSurface
      eyebrow="Professional Communities"
      title="Professional maritime communities, not another noisy group chat."
      description="Focused spaces where seafarers, shore professionals, mentors and maritime specialists can discuss real work, share lessons and build professional reputation."
      note="Community membership, discussions, moderation and reputation will reuse the same Sea N Shore professional identity, keeping expertise visible across the platform."
      items={items}
    />
  )
}
