import type { ReactNode } from 'react'
import { Pencil, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/cn'

/**
 * One heading / label / value style for every profile section card (About,
 * Experience, Sea service, Credentials, Skills, Access & goals, Organizations…),
 * on the member's own profile and on the public profile.
 */
export const profileSectionTitleClass = 'text-lg font-bold text-navy-950'
export const profileSubheadingClass = 'text-sm font-bold text-navy-950'
export const profileFieldLabelClass = 'text-xs font-semibold uppercase tracking-wide text-muted'
export const profileFieldValueClass = 'text-sm text-ink'

export function ProfileSection({
  id,
  title,
  description,
  action,
  children,
  className,
  headingLevel = 2,
}: {
  /** Base id; the heading gets `${id}-heading` and labels the section. */
  id: string
  title: ReactNode
  description?: ReactNode
  /** Edit / add button shown next to the title. */
  action?: ReactNode
  children?: ReactNode
  className?: string
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 3 ? 'h3' : 'h2'
  const headingId = `${id}-heading`
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn('scroll-mt-24 rounded-[var(--radius-card)] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6', className)}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Heading id={headingId} className={profileSectionTitleClass}>{title}</Heading>
          {description ? <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {children}
    </section>
  )
}

/** A definition list laid out in one or two columns. */
export function ProfileFieldList({
  children,
  className,
  columns = 2,
}: {
  children: ReactNode
  className?: string
  columns?: 1 | 2 | 3
}) {
  return (
    <dl
      className={cn(
        'grid gap-x-6 gap-y-4',
        columns === 2 ? 'sm:grid-cols-2' : columns === 3 ? 'sm:grid-cols-2 lg:grid-cols-3' : null,
        className,
      )}
    >
      {children}
    </dl>
  )
}

/** One labelled value inside a ProfileFieldList. */
export function ProfileField({
  label,
  icon: Icon,
  children,
  className,
}: {
  label: ReactNode
  icon?: LucideIcon
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className={cn(profileFieldLabelClass, 'flex items-center gap-1.5')}>
        {Icon ? <Icon aria-hidden="true" className="size-3.5 shrink-0 text-ocean-700" /> : null}
        {label}
      </dt>
      <dd className={cn(profileFieldValueClass, 'mt-1 break-words leading-6')}>{children}</dd>
    </div>
  )
}

/** A round icon-only edit button used in section headers. */
export function ProfileSectionEditButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="inline-flex size-9 items-center justify-center rounded-full border border-mist-200 text-navy-950 transition-colors hover:border-ocean-500 hover:text-ocean-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
    >
      <Pencil aria-hidden="true" className="size-4" />
    </button>
  )
}
