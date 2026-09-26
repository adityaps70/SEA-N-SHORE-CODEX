import Link from 'next/link'
import { Bell, MessageCircleMore, Search, SquarePlus } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'
import { MessagingUnreadBadge } from '@/features/messaging/components/messaging-unread-badge'
import { ViewerAvatar, type HeaderViewer } from './viewer-avatar'

const iconLinkClass = 'relative grid min-h-10 min-w-10 place-items-center rounded-xl text-navy-900 hover:bg-mist-50'
const badgeClass = 'absolute right-0 top-0 inline-flex min-w-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white'

export function MobileAppHeader({
  unreadCount,
  messagingUnreadCount = 0,
  viewer = { name: 'Member', avatarUrl: null },
}: {
  unreadCount: number
  messagingUnreadCount?: number
  /** Kept for call-site compatibility; admin access now lives in the bottom "More" menu. */
  canAccessAdmin?: boolean
  viewer?: HeaderViewer
}) {
  return (
    <header className="border-b border-mist-100 bg-white md:hidden">
      <div className="flex min-h-14 items-center justify-between gap-2 px-3 sm:px-4">
        <div className="min-w-0 max-w-[40%] shrink [&_img]:h-9 sm:max-w-none sm:[&_img]:h-11"><Wordmark compact /></div>
        <div className="flex shrink-0 items-center gap-0.5">
          <Link href="/search" aria-label="Search" className={iconLinkClass}>
            <Search aria-hidden="true" className="size-5" />
          </Link>
          <Link
            href="/creator"
            aria-label="Create"
            className="mx-0.5 inline-flex min-h-9 min-w-9 items-center justify-center gap-1.5 rounded-lg bg-ocean-700 px-2 text-xs font-bold text-white transition hover:bg-ocean-800"
          >
            <SquarePlus aria-hidden="true" className="size-4 shrink-0" />
            <span className="hidden whitespace-nowrap min-[420px]:inline">Create</span>
          </Link>
          <Link href="/messages" aria-label="Messages" className={iconLinkClass}>
            <MessageCircleMore aria-hidden="true" className="size-5" />
            <MessagingUnreadBadge initialCount={messagingUnreadCount} className={badgeClass} />
          </Link>
          <Link href="/notifications" aria-label="Notifications" className={iconLinkClass}>
            <Bell aria-hidden="true" className="size-5" />
            {unreadCount > 0 ? <span className={badgeClass}>{unreadCount > 9 ? '9+' : unreadCount}</span> : null}
          </Link>
          <Link href="/profile" aria-label="Profile" className={iconLinkClass}>
            <ViewerAvatar viewer={viewer} className="size-8" />
          </Link>
        </div>
      </div>
    </header>
  )
}
