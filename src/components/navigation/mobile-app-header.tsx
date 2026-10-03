'use client'

import Link from 'next/link'
import { MessageCircleMore, Search } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useState } from 'react'
import { MessagingUnreadBadge } from '@/features/messaging/components/messaging-unread-badge'
import type { HeaderOrganization } from './account-menu'
import { isPhoneDetailRoute } from './mobile-routes'
import { SIDE_DRAWER_ID, SideDrawer } from './side-drawer'
import { ViewerAvatar, type HeaderViewer } from './viewer-avatar'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'
const badgeClass = 'absolute right-0.5 top-0.5 inline-flex min-w-5 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white'

/**
 * Phone top bar (round 8, below `md` only): profile photo (opens the side drawer) · search bar
 * (links to /search) · Messages with its unread badge. Notifications and Create are bottom tabs.
 * Detail routes (see mobile-routes.ts) render their own MobilePageBar instead, so the bar is
 * not rendered there.
 */
export function MobileAppHeader({
  messagingUnreadCount = 0,
  canAccessAdmin = false,
  viewer = { name: 'Member', avatarUrl: null },
  organizations = [],
  organizationCount = organizations.length,
}: {
  messagingUnreadCount?: number
  canAccessAdmin?: boolean
  viewer?: HeaderViewer
  organizations?: HeaderOrganization[]
  organizationCount?: number
}) {
  const pathname = usePathname()
  // The drawer remembers the page it was opened on, so any navigation (back/forward or a link
  // outside it) closes it.
  const [openedOn, setOpenedOn] = useState<{ pathname: string | null } | null>(null)
  const drawerOpen = openedOn !== null && openedOn.pathname === pathname
  const closeDrawer = useCallback(() => setOpenedOn(null), [])

  if (pathname && isPhoneDetailRoute(pathname)) return null

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-mist-100 bg-white pt-[env(safe-area-inset-top)] md:hidden">
        <div className="flex min-h-14 items-center gap-2 px-2">
          <button
            type="button"
            aria-label="Open menu"
            aria-haspopup="dialog"
            aria-expanded={drawerOpen}
            aria-controls={drawerOpen ? SIDE_DRAWER_ID : undefined}
            onClick={() => setOpenedOn({ pathname })}
            className={`grid size-11 shrink-0 cursor-pointer place-items-center rounded-full ${focusRing}`}
          >
            <ViewerAvatar viewer={viewer} className="size-8" />
          </button>
          <Link
            href="/search"
            className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full bg-mist-100 px-3.5 text-[15px] text-muted hover:bg-mist-200 ${focusRing}`}
          >
            <Search aria-hidden="true" className="size-5 shrink-0 text-navy-700" />
            <span className="truncate">Search jobs, people, courses</span>
          </Link>
          <Link
            href="/messages"
            aria-label="Messages"
            className={`relative grid size-11 shrink-0 place-items-center rounded-full text-navy-900 hover:bg-mist-50 ${focusRing}`}
          >
            <MessageCircleMore aria-hidden="true" className="size-6" strokeWidth={1.75} />
            <MessagingUnreadBadge initialCount={messagingUnreadCount} className={badgeClass} />
          </Link>
        </div>
      </header>
      {/* Outside the sticky header, so the drawer is not held inside the header's stacking context. */}
      <SideDrawer
        open={drawerOpen}
        onClose={closeDrawer}
        viewer={viewer}
        organizations={organizations}
        organizationCount={organizationCount}
        canAccessAdmin={canAccessAdmin}
      />
    </>
  )
}
