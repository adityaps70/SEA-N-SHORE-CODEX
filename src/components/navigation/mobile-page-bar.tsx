import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

/**
 * Phone detail-page bar (round 8): back arrow, page title and a right-hand slot for that page's
 * "…" menu or one action. Rendered only below `md`; desktop pages keep their own headers.
 *
 * Detail pages (post, job, event, course, chat, settings sub-pages) render this at the top of
 * their content. The app layout hides the global phone top bar on those routes via
 * `isDetailRoute` in mobile-routes.ts, so the page bar takes its place.
 */
export function MobilePageBar({
  backHref,
  title,
  right,
  className = '',
}: {
  backHref: string
  title?: ReactNode
  right?: ReactNode
  className?: string
}) {
  return (
    <div
      className={`sticky top-[env(safe-area-inset-top,0px)] z-[45] -mx-4 -mt-4 mb-3 flex min-h-14 items-center gap-2 border-b border-mist-100 bg-white px-2 md:hidden ${className}`}
    >
      <Link
        href={backHref}
        aria-label="Back"
        className="grid size-11 shrink-0 place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <ArrowLeft aria-hidden="true" className="size-6" />
      </Link>
      <div className="min-w-0 flex-1 truncate text-[17px] font-bold text-navy-950">{title}</div>
      {right ? <div className="flex shrink-0 items-center gap-1">{right}</div> : null}
    </div>
  )
}
