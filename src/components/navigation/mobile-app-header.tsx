import Link from 'next/link'
import { Bell, Bookmark, MessageCircleMore, Settings, ShieldCheck, SquarePlus } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'
import { MessagingUnreadBadge } from '@/features/messaging/components/messaging-unread-badge'

export function MobileAppHeader({
  unreadCount,
  messagingUnreadCount = 0,
  canAccessAdmin = false,
}: {
  unreadCount: number
  messagingUnreadCount?: number
  canAccessAdmin?: boolean
}) {
  return (
    <header className="border-b border-mist-100 bg-white md:hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4">
        <Wordmark compact />
        <div className="flex items-center gap-1">
          <Link
            href="/creator"
            aria-label="Create"
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-ocean-700 px-2.5 text-xs font-bold text-white transition hover:bg-ocean-800"
          >
            <SquarePlus aria-hidden="true" className="size-4 shrink-0" />
            <span className="whitespace-nowrap">Create</span>
          </Link>
          {canAccessAdmin ? (
            <Link
              href="/admin"
              aria-label="Admin"
              className="grid min-h-10 min-w-10 place-items-center rounded-xl border border-ocean-200 bg-ocean-50 text-ocean-800 transition hover:bg-ocean-100"
            >
              <ShieldCheck aria-hidden="true" className="size-5" />
            </Link>
          ) : null}
          <Link
            href="/settings"
            aria-label="Settings"
            className="grid min-h-10 min-w-10 place-items-center rounded-xl text-navy-900 hover:bg-mist-50"
          >
            <Settings aria-hidden="true" className="size-5" />
          </Link>
          <Link
            href="/saved"
            aria-label="Saved posts"
            className="grid min-h-10 min-w-10 place-items-center rounded-xl text-navy-900 hover:bg-mist-50"
          >
            <Bookmark aria-hidden="true" className="size-5" />
          </Link>
          <Link
            href="/messages"
            aria-label="Messages"
            className="relative grid min-h-10 min-w-10 place-items-center rounded-xl text-navy-900 hover:bg-mist-50"
          >
            <MessageCircleMore aria-hidden="true" className="size-5" />
            <MessagingUnreadBadge
              initialCount={messagingUnreadCount}
              className="absolute right-0 top-0 inline-flex min-w-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white"
            />
          </Link>
          <Link
            href="/notifications"
            aria-label="Notifications"
            className="relative grid min-h-10 min-w-10 place-items-center rounded-xl text-navy-900 hover:bg-mist-50"
          >
            <Bell aria-hidden="true" className="size-5" />
            {unreadCount > 0 ? (
              <span className="absolute right-0 top-0 inline-flex min-w-5 -translate-y-1/4 translate-x-1/4 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            ) : null}
          </Link>
        </div>
      </div>
    </header>
  )
}
