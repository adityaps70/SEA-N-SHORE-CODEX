import type { ReactNode } from 'react'
import type { OwnProfile } from '@/features/profiles/types'
import type { PostCategory } from '../types'
import { FeedDiscoveryRail } from './feed-discovery-rail'
import { FeedProfileCard } from './feed-profile-card'

export function FeedLayout({
  profile,
  category,
  children,
}: {
  profile: OwnProfile
  category?: PostCategory
  children: ReactNode
}) {
  return (
    <section className="grid gap-5 py-2 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        <div className="sticky top-6">
          <FeedProfileCard profile={profile} />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 lg:hidden">
          <FeedProfileCard profile={profile} compact />
        </div>
        {children}
      </main>

      <aside className="hidden xl:block">
        <div className="sticky top-6">
          <FeedDiscoveryRail category={category} />
        </div>
      </aside>
    </section>
  )
}
