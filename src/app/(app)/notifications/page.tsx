import type { Metadata } from 'next'
import { BellRing } from 'lucide-react'
import { NotificationList } from '@/features/notifications/components/notification-list'
import { getNotifications } from '@/features/notifications/queries'

export const metadata: Metadata = { title: 'Notifications' }

export default async function NotificationsPage() {
  const notifications = await getNotifications(50)

  return (
    <section className="mx-auto max-w-3xl py-2 max-md:-mt-4 max-md:py-0 sm:py-5">
      {/* Phones: the list's compact "Notifications · Mark all read" row replaces this card. */}
      <div className="mb-5 rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:hidden sm:p-7">
        <div className="flex items-start gap-4">
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
            <BellRing aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Activity</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">Notifications</h1>
            <p className="mt-2 text-sm leading-6 text-muted">Reactions and comments on your posts, connection requests and new followers.</p>
          </div>
        </div>
      </div>
      <NotificationList notifications={notifications} />
    </section>
  )
}
