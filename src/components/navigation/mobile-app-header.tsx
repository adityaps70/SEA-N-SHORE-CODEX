import Link from 'next/link'
import { Bell } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'

export function MobileAppHeader({ unreadCount }: { unreadCount: number }) {
  return (
    <header className="border-b border-mist-100 bg-white md:hidden">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4">
        <Wordmark />
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
    </header>
  )
}
