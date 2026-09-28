import { BadgeCheck, CircleDashed } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * "Verified" or "Unclaimed" next to an organization name. Unverified organizations
 * that are claimed (still in review, or legacy pages) show nothing.
 */
export function OrganizationStatusBadge({
  organization,
  size = 'md',
  className,
}: {
  organization: { verified?: boolean; unclaimed?: boolean }
  size?: 'sm' | 'md'
  className?: string
}) {
  if (organization.verified) {
    if (size === 'sm') {
      return <BadgeCheck role="img" aria-label="Verified organization" className={cn('size-3.5 shrink-0 text-ocean-700', className)} />
    }
    return (
      <span className={cn('inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800', className)}>
        <BadgeCheck aria-hidden="true" className="size-3.5" /> Verified
      </span>
    )
  }
  if (organization.unclaimed) {
    return (
      <span
        title="Added by someone who works there. Nobody manages this page yet."
        className={cn(
          'inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 font-semibold text-amber-900',
          size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-0.5 text-xs',
          className,
        )}
      >
        <CircleDashed aria-hidden="true" className="size-3" /> Unclaimed
      </span>
    )
  }
  return null
}
