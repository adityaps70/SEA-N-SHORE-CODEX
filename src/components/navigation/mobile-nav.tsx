import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  History,
  House,
  MessagesSquare,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { ActiveNavLink } from './active-nav-link'

const destinations = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/network', label: 'Network', icon: UsersRound },
  { href: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/community', label: 'Community', icon: MessagesSquare },
  { href: '/learn', label: 'Learn', icon: BookOpenCheck },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/activities', label: 'Activities', accessibleLabel: 'My Activities', icon: History },
  { href: '/profile', label: 'Profile', icon: UserRound },
] as const

export function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-8 border-t border-mist-100 bg-white/95 md:hidden"
    >
      {destinations.map((destination) => {
        const Icon = destination.icon
        const accessibleLabel = 'accessibleLabel' in destination ? destination.accessibleLabel : destination.label
        return (
          <ActiveNavLink
            key={destination.href}
            href={destination.href}
            aria-label={accessibleLabel}
            activeClassName="bg-ocean-50 text-ocean-700"
            className="flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-0.5 text-center text-[9px] font-medium leading-tight text-navy-900"
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="max-w-full truncate">{destination.label}</span>
          </ActiveNavLink>
        )
      })}
    </nav>
  )
}
