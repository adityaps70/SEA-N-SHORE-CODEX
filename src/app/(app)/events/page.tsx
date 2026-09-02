import { Award, CalendarDays, Clapperboard, Mic2, RadioTower, UsersRound } from 'lucide-react'
import { ProductSurface } from '@/components/product/product-surface'

const items = [
  {
    title: 'Expert webinars',
    description: 'Live sessions with Master Mariners, Chief Engineers, superintendents, surveyors, lawyers and domain experts.',
    meta: 'Online',
    icon: Mic2,
  },
  {
    title: 'Workshops',
    description: 'Focused professional workshops around safety, vetting, careers, technology, leadership and maritime practice.',
    meta: 'Interactive',
    icon: RadioTower,
  },
  {
    title: 'Networking events',
    description: 'Bring sea-going and shore-side professionals together around meaningful industry relationships and opportunities.',
    meta: 'Community',
    icon: UsersRound,
  },
  {
    title: 'Maritime awards',
    description: 'Recognise contribution, seamanship, innovation, mentorship and professional impact across the community.',
    meta: 'Recognition',
    icon: Award,
  },
  {
    title: 'Upcoming programme',
    description: 'A single calendar for webinars, conferences, workshops and community events with registration-ready event pages.',
    meta: 'Discover',
    icon: CalendarDays,
  },
  {
    title: 'Event archive',
    description: 'Keep valuable recordings, speaker profiles and event media discoverable instead of losing them after the live session ends.',
    meta: 'Knowledge library',
    icon: Clapperboard,
  },
]

export default function EventsPage() {
  return (
    <ProductSurface
      eyebrow="Sea N Shore Events"
      title="Maritime events that continue creating value after the session ends."
      description="Webinars, workshops and networking programmes connected to speakers, communities, recordings and professional learning."
      note="The event architecture is being designed as part of the wider professional graph, so speakers, attendees, communities and recordings can connect instead of living as isolated event listings."
      items={items}
    />
  )
}
