import { avatarPx, avatarSizes } from '@/lib/images/media-image-source'
import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared building blocks for the admin console. Every admin page uses the same
 * compact header, filter chips with counts and table shell so the console reads
 * as one tool instead of a stack of marketing cards.
 */

export function AdminPageHeader({
  title,
  description,
  meta,
  actions,
}: {
  title: string
  description?: string
  /** Short summary shown beside the title, e.g. "34 accounts". */
  meta?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="flex flex-col gap-3 border-b border-mist-100 pb-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="text-2xl font-bold tracking-tight text-navy-950">{title}</h2>
          {meta ? <p className="text-sm font-medium text-muted">{meta}</p> : null}
        </div>
        {description ? <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

export type AdminFilterOption = {
  href: string
  label: string
  active: boolean
  count?: number | null
}

export function AdminFilterBar({ label, options }: { label: string; options: AdminFilterOption[] }) {
  return (
    <nav aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <Link
          key={option.href}
          href={option.href}
          aria-current={option.active ? 'true' : undefined}
          className={`inline-flex min-h-9 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition ${
            option.active
              ? 'border-navy-950 bg-navy-950 text-white'
              : 'border-mist-200 bg-white text-navy-900 hover:border-mist-200 hover:bg-mist-50'
          }`}
        >
          {option.label}
          {typeof option.count === 'number' ? (
            <span className={`rounded-md px-1.5 text-xs font-bold ${option.active ? 'bg-white/15 text-white' : 'bg-mist-50 text-muted'}`}>
              {option.count}
            </span>
          ) : null}
        </Link>
      ))}
    </nav>
  )
}

const toneClasses = {
  neutral: 'border-mist-200 bg-mist-50 text-navy-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-ocean-200 bg-ocean-50 text-ocean-800',
} as const

export type AdminChipTone = keyof typeof toneClasses

export function AdminChip({ tone = 'neutral', children }: { tone?: AdminChipTone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}

/** A white, bordered surface that holds a table or list. */
export function AdminPanel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section className={`overflow-hidden rounded-xl border border-mist-100 bg-white ${className}`.trim()}>
      {children}
    </section>
  )
}

export function AdminEmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="px-6 py-12 text-center">
      <p className="font-semibold text-navy-950">{title}</p>
      {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
    </div>
  )
}

export function formatAdminDate(value: string | null | undefined, withTime = false) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-GB', withTime
    ? { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }
    : { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** Heuristic for records created by automated tests, so they can be flagged instead of mistaken for members. */
export function looksLikeTestAccount(input: { fullName?: string | null; email?: string | null; slug?: string | null }) {
  const name = input.fullName?.trim() ?? ''
  const email = input.email?.toLowerCase() ?? ''
  const slug = input.slug?.toLowerCase() ?? ''
  return /^e2e\b/i.test(name) || email.endsWith('@example.com') || slug.startsWith('e2e-')
}

export function adminInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?'
}

/** Small round profile photo for admin lists, with initials when there is no photo. */
export function AdminAvatar({ name, url, className = 'size-8' }: { name: string; url: string | null | undefined; className?: string }) {
  const fallback = (
    <span aria-hidden="true" className={`${className} grid shrink-0 place-items-center rounded-full bg-mist-100 text-[11px] font-bold text-navy-950`}>
      {adminInitials(name)}
    </span>
  )
  if (url) {
    const px = avatarPx(className, 32)
    return (
      <MediaImage avatar src={url} alt="" width={px} height={px} sizes={avatarSizes(className, 32)} className={`${className} shrink-0 rounded-full bg-mist-100 object-cover`} fallback={fallback} />
    )
  }
  return fallback
}

/** 1-based page number from a search parameter; anything invalid is page 1. */
export function readAdminPage(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value
  const page = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(page) && page > 1 ? Math.min(page, 10_000) : 1
}

/** Previous / next links under an admin list. Renders nothing when everything fits on one page. */
export function AdminPagination({
  label,
  page,
  hasNext,
  hrefFor,
}: {
  label: string
  page: number
  hasNext: boolean
  hrefFor: (page: number) => string
}) {
  if (page <= 1 && !hasNext) return null
  const linkClass = 'inline-flex min-h-9 items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-950 transition hover:border-ocean-200 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'
  const disabledClass = 'inline-flex min-h-9 items-center rounded-lg border border-mist-100 px-3 text-sm font-semibold text-muted'
  return (
    <nav aria-label={label} className="flex items-center justify-between gap-3">
      {page > 1
        ? <Link href={hrefFor(page - 1)} rel="prev" className={linkClass}>Previous</Link>
        : <span aria-disabled="true" className={disabledClass}>Previous</span>}
      <p className="text-sm font-medium text-muted">Page {page}</p>
      {hasNext
        ? <Link href={hrefFor(page + 1)} rel="next" className={linkClass}>Next</Link>
        : <span aria-disabled="true" className={disabledClass}>Next</span>}
    </nav>
  )
}
