import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'
import { profileSubheadingClass } from './profile-section'

/** A box inside "Access & goals": an icon title, an optional pencil and its content. */
export function MembershipPanel({
  id,
  title,
  icon: Icon,
  action,
  className,
  children,
}: {
  id: string
  title: string
  icon: LucideIcon
  action?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <article aria-labelledby={id} className={cn('min-w-0 rounded-2xl border border-mist-100 bg-mist-50/60 p-4', className)}>
      <div className="flex items-start justify-between gap-2">
        <h3 id={id} className={`${profileSubheadingClass} flex items-center gap-2`}>
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-white text-ocean-700 shadow-sm">
            <Icon aria-hidden="true" className="size-4" />
          </span>
          {title}
        </h3>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </article>
  )
}
