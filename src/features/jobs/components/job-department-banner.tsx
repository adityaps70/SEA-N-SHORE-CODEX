import Link from 'next/link'
import { TriangleAlert } from 'lucide-react'

/**
 * Round 12: an open job without a department and accepted ranks is matched from its old rank text.
 * Recruiters see this on their hiring dashboard and on the job until they pick them.
 */
export function JobDepartmentBanner({ href, count, className = '' }: { href: string; count?: number; className?: string }) {
  return (
    <div role="status" data-testid="job-department-banner" className={`flex flex-wrap items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 ${className}`}>
      <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <span className="font-semibold">Pick a department and accepted ranks so candidates are matched correctly.</span>
        {count && count > 1 ? <span> {count} open jobs need this.</span> : null}{' '}
        <Link href={href} className="font-semibold text-ocean-800 underline-offset-2 hover:underline">
          {count && count > 1 ? 'Review your jobs' : 'Edit the job'}
        </Link>
      </p>
    </div>
  )
}
