import { BookOpenCheck, BriefcaseBusiness, House, MessagesSquare, UsersRound } from 'lucide-react'
import { ActiveNavLink } from './active-nav-link'

/**
 * Five thumb-sized destinations, the mobile platform maximum. Messages,
 * notifications and the account menu (Profile, Events, Organizations, Admin,
 * Settings) live in the phone top header.
 */
const destinations = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/network', label: 'Network', accessibleLabel: 'My Network', icon: UsersRound },
  { href: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/learn', label: 'Learn', icon: BookOpenCheck },
  { href: '/community', label: 'Community', icon: MessagesSquare },
] as const

const navClass = 'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-0.5 text-center text-[11px] font-medium leading-tight text-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500'
const activeNavClass = 'border-ocean-600 bg-ocean-50 text-ocean-700'

export function MobileNav() {
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-mist-100 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {destinations.map((destination) => {
        const Icon = destination.icon
        const accessibleLabel = 'accessibleLabel' in destination ? destination.accessibleLabel : destination.label
        return (
          <ActiveNavLink
            key={destination.href}
            href={destination.href}
            aria-label={accessibleLabel}
            activeClassName={activeNavClass}
            className={navClass}
          >
            <Icon aria-hidden="true" className="size-5 shrink-0" />
            <span className="max-w-full truncate">{destination.label}</span>
          </ActiveNavLink>
        )
      })}
    </nav>
  )
}
