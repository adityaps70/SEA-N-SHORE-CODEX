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
      className={cn('scroll-mt-24 rounded-[var(--radius-card)] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6', PROFILE_SECTION_PHONE_CLASS, className)}
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

/**
 * Phones (below md): sections run edge to edge like app rows — no side borders, radius or
 * shadow, cancelling the app main's 16px gutter. Desktop keeps the card.
 */
export const PROFILE_SECTION_PHONE_CLASS = 'max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:py-5 max-md:shadow-none'

/** "Add …" section button: a labelled dark button on desktop, a round 44px plus icon on phones. */
export const PHONE_ICON_ADD_BUTTON_CLASS = 'inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-800 transition-colors max-md:size-11 max-md:min-h-0 max-md:justify-center max-md:rounded-full max-md:bg-transparent max-md:px-0 max-md:text-navy-950 max-md:hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600'

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

/** A round icon-only edit button used in section headers (44px, borderless on phones). */
export function ProfileSectionEditButton({
  label,
  onClick,
  icon: Icon = Pencil,
  className,
  pressed,
}: {
  label: string
  onClick: () => void
  icon?: LucideIcon
  className?: string
  /** Toggle buttons (the phone "edit entries" pencil) report their state. */
  pressed?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full border border-mist-200 text-navy-950 transition-colors hover:border-ocean-500 hover:text-ocean-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600 max-md:size-11 max-md:border-transparent max-md:hover:bg-mist-50 aria-pressed:bg-ocean-50 aria-pressed:text-ocean-700',
        className,
      )}
    >
      <Icon aria-hidden="true" className="size-4 max-md:size-5" />
    </button>
  )
}
