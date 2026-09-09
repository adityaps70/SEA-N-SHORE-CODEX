import Link from 'next/link'
import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  History,
  House,
  LogOut,
  MessagesSquare,
  Search,
  UserRound,
  UsersRound,
} from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'
import { signOut } from '@/features/auth/actions'
import { NotificationBell } from '@/features/notifications/components/notification-bell'
import type { NetworkNotification } from '@/features/notifications/types'
import { ActiveNavLink } from './active-nav-link'

const destinations = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/network', label: 'My Network', icon: UsersRound },
  { href: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/community', label: 'Community', icon: MessagesSquare },
  { href: '/learn', label: 'Learn', icon: BookOpenCheck },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/activities', label: 'My Activities', icon: History },
] as const

const navClass = 'inline-flex min-h-14 min-w-10 flex-col items-center justify-center gap-1 rounded-lg border-b-2 border-transparent px-1.5 font-medium text-navy-900 transition hover:bg-mist-50 xl:min-w-[4.25rem]'
const activeNavClass = 'border-ocean-600 bg-ocean-50 text-ocean-700'

export function AppHeader({
  recentNotifications,
  unreadCount,
}: {
  recentNotifications: NetworkNotification[]
  unreadCount: number
}) {
  return (
    <header className="fixed inset-x-0 top-0 z-50 hidden border-b border-mist-100 bg-white md:block">
      <div className="mx-auto grid min-h-18 w-full max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 xl:gap-5">
        <Wordmark compact />
        <nav aria-label="Primary" className="flex items-center justify-self-center gap-0.5">
          {destinations.map(({ href, label, icon: Icon }) => (
            <ActiveNavLink
              key={href}
              href={href}
              aria-label={label}
              title={label}
              className={navClass}
              activeClassName={activeNavClass}
            >
              <Icon aria-hidden="true" className="size-4.5 shrink-0" />
              <span className="hidden whitespace-nowrap text-[11px] leading-none xl:block">{label}</span>
            </ActiveNavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          <form action="/network" method="get" role="search" className="relative hidden lg:block">
            <input type="hidden" name="tab" value="discover" />
            <label htmlFor="global-search" className="sr-only">Search maritime professionals</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              id="global-search"
              name="q"
              type="search"
              maxLength={100}
              placeholder="Search people"
              className="min-h-10 w-64 rounded-lg bg-mist-50 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted 2xl:w-[22rem]"
            />
          </form>
          <NotificationBell recent={recentNotifications} unreadCount={unreadCount} />
          <ActiveNavLink
            href="/profile"
            aria-label="Profile"
            title="Profile"
            className="inline-flex min-h-14 min-w-10 flex-col items-center justify-center gap-1 rounded-lg border-b-2 border-transparent px-1.5 font-semibold text-navy-900 transition hover:bg-mist-50 xl:min-w-[4rem]"
            activeClassName={activeNavClass}
          >
            <UserRound aria-hidden="true" className="size-4.5" />
            <span className="hidden whitespace-nowrap text-[11px] leading-none xl:block">Profile</span>
          </ActiveNavLink>
          <form action={signOut}>
            <button type="submit" aria-label="Sign out" title="Sign out" className="grid min-h-10 min-w-10 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-900">
              <LogOut aria-hidden="true" className="size-4" />
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
