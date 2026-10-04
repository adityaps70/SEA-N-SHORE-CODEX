import {
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  GraduationCap,
  House,
  MessageCircleMore,
  MessagesSquare,
  Search,
  SquarePlus,
  UsersRound,
} from 'lucide-react'
import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { MessagingUnreadBadge } from '@/features/messaging/components/messaging-unread-badge'
import { NotificationBell } from '@/features/notifications/components/notification-bell'
import type { NetworkNotification } from '@/features/notifications/types'
import { AccountMenuSignOut, accountMenuItems, type HeaderOrganization } from './account-menu'
import { ActiveNavLink } from './active-nav-link'
import { HeaderMenu, type HeaderMenuItem } from './header-menu'
import { ViewerAvatar, type HeaderViewer } from './viewer-avatar'

export { organizationMenuItems, type HeaderOrganization } from './account-menu'

/**
 * Seven primary destinations fit at 1024px without clipping. My Activities is
 * in Settings, Saved posts is on the Home left rail, and Organizations, Admin
 * and Settings are in the account menu.
 */
const destinations = [
  { href: '/home', label: 'Home', icon: House },
  { href: '/network', label: 'My Network', icon: UsersRound },
  { href: '/jobs', label: 'Jobs', icon: BriefcaseBusiness },
  { href: '/messages', label: 'Messages', icon: MessageCircleMore },
  { href: '/learn', label: 'Learn', icon: BookOpenCheck },
  { href: '/events', label: 'Events', icon: CalendarDays },
  { href: '/community', label: 'Community', icon: MessagesSquare },
] as const

const createItems: HeaderMenuItem[] = [
  { href: '/hiring/jobs/new', label: 'Post a job', description: 'Sea or shore vacancy with structured requirements', icon: <BriefcaseBusiness className="size-4" /> },
  { href: '/events/create', label: 'Create an event', description: 'Webinar, masterclass, meetup or conference', icon: <CalendarDays className="size-4" /> },
  { href: '/learn/studio/courses/new', label: 'Create a course', description: 'Build maritime learning in Learning Studio', icon: <GraduationCap className="size-4" /> },
  // Round 9C: the page explains Creator Pro / Organization Pro when the member cannot create yet.
  { href: '/community/new', label: 'Create a community', description: 'Your own group, with Creator Pro or Organization Pro', icon: <UsersRound className="size-4" /> },
  { href: '/creator', label: 'All creator tools', description: 'Publishing access, verification and organization workspaces', icon: <SquarePlus className="size-4" /> },
]

const navClass = 'relative inline-flex min-h-14 min-w-[3.25rem] flex-col items-center justify-center gap-1 rounded-lg border-b-2 border-transparent px-1.5 font-medium text-navy-900 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 xl:min-w-[4.25rem]'
const activeNavClass = 'border-ocean-600 bg-ocean-50 text-ocean-700'

export function AppHeader({
  recentNotifications,
  unreadCount,
  messagingUnreadCount = 0,
  canAccessAdmin = false,
  viewer = { name: 'Member', avatarUrl: null },
  organizations = [],
  organizationCount = organizations.length,
}: {
  recentNotifications: NetworkNotification[]
  unreadCount: number
  messagingUnreadCount?: number
  canAccessAdmin?: boolean
  viewer?: HeaderViewer
  /** The first few organizations the member belongs to (owners and administrators first). */
  organizations?: HeaderOrganization[]
  organizationCount?: number
}) {
  const accountItems = accountMenuItems({ canAccessAdmin, organizations, organizationCount })

  return (
    <header className="fixed inset-x-0 top-0 z-50 hidden border-b border-mist-100 bg-white md:block">
      <div className="mx-auto grid min-h-18 w-full max-w-7xl grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-4 xl:gap-5">
        <Wordmark compact />
        <nav aria-label="Primary" className="flex min-w-0 items-center justify-self-center gap-0.5">
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
              {href === '/messages' ? (
                <MessagingUnreadBadge
                  initialCount={messagingUnreadCount}
                  className="absolute right-0.5 top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white"
                />
              ) : null}
              <span className="hidden whitespace-nowrap text-[11px] leading-none xl:block">{label}</span>
            </ActiveNavLink>
          ))}
        </nav>
        <div className="flex items-center gap-1.5">
          {/* Tablets (md to lg) have no room for the search field; this icon takes its place. */}
          <Link
            href="/search"
            aria-label="Search"
            title="Search"
            className="grid min-h-10 min-w-10 place-items-center rounded-lg text-navy-900 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 lg:hidden"
          >
            <Search aria-hidden="true" className="size-5" />
          </Link>
          <form action="/search" method="get" role="search" className="relative hidden lg:block">
            <label htmlFor="global-search" className="sr-only">Search Sea N Shore</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              id="global-search"
              name="q"
              type="search"
              maxLength={100}
              placeholder="Search Sea N Shore"
              className="min-h-10 w-44 rounded-lg bg-mist-50 py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted xl:w-56 2xl:w-[22rem]"
            />
          </form>
          <HeaderMenu
            label="Create"
            items={createItems}
            triggerClassName="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-ocean-700 px-3 text-sm font-semibold text-white transition hover:bg-ocean-800"
            trigger={(
              <>
                <SquarePlus aria-hidden="true" className="size-4 shrink-0" />
                <span className="whitespace-nowrap">Create</span>
              </>
            )}
          />
          <NotificationBell recent={recentNotifications} unreadCount={unreadCount} />
          <HeaderMenu
            label="Account menu"
            items={accountItems}
            menuWidthClassName="w-72"
            showChevron
            triggerClassName="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-1.5 text-navy-900 transition hover:bg-mist-50"
            activeTriggerClassName="bg-ocean-50 text-ocean-700"
            trigger={<ViewerAvatar viewer={viewer} />}
            footer={<AccountMenuSignOut />}
          />
        </div>
      </div>
    </header>
  )
}
