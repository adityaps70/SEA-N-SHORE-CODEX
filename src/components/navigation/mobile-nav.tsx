import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  Ellipsis,
  History,
  House,
  MessageCircleMore,
  MessagesSquare,
  Settings,
  ShieldCheck,
  UserRound,
  UsersRound,
  Bookmark,
} from 'lucide-react'
import { ActiveNavLink } from './active-nav-link'
import { HeaderMenu, type HeaderMenuItem } from './header-menu'

/** Four destinations plus More: five thumb-sized targets, the mobile platform maximum. */
const destinations = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/network', label: 'Network', accessibleLabel: 'My Network', icon: UsersRound },
  { href: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/learn', label: 'Learn', icon: BookOpenCheck },
] as const

const navClass = 'flex min-h-16 min-w-0 flex-col items-center justify-center gap-1 border-t-2 border-transparent px-0.5 text-center text-[11px] font-medium leading-tight text-navy-900'
const activeNavClass = 'border-ocean-600 bg-ocean-50 text-ocean-700'

export function MobileNav({ canAccessAdmin = false }: { canAccessAdmin?: boolean }) {
  const moreItems: HeaderMenuItem[] = [
    { href: '/events', label: 'Events', icon: <CalendarDays className="size-4" /> },
    { href: '/messages', label: 'Messages', icon: <MessageCircleMore className="size-4" /> },
    { href: '/activities', label: 'My Activities', icon: <History className="size-4" /> },
    { href: '/saved', label: 'Saved posts', icon: <Bookmark className="size-4" /> },
    { href: '/community', label: 'Community', badge: 'Preview', icon: <MessagesSquare className="size-4" /> },
    { href: '/profile', label: 'Profile', icon: <UserRound className="size-4" /> },
    ...(canAccessAdmin ? [{ href: '/admin', label: 'Admin', icon: <ShieldCheck className="size-4" /> }] : []),
    { href: '/settings', label: 'Settings', icon: <Settings className="size-4" /> },
  ]

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
      <HeaderMenu
        label="More"
        direction="up"
        align="right"
        showChevron={false}
        items={moreItems}
        triggerClassName={`${navClass} w-full`}
        activeTriggerClassName={activeNavClass}
        trigger={(
          <>
            <Ellipsis aria-hidden="true" className="size-5 shrink-0" />
            <span className="max-w-full truncate">More</span>
          </>
        )}
      />
    </nav>
  )
}
