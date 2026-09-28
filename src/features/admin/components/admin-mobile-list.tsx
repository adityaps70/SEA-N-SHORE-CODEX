import Link from 'next/link'
import type { ReactNode } from 'react'
import { PageActionsSheet, type PageAction } from '@/features/learning/components/page-actions-sheet'

/**
 * Phone card lists for wide admin tables (round 8). Pages render the table inside
 * `ADMIN_TABLE_DESKTOP_CLASS` and the same rows as <AdminMobileList> for phones: name first,
 * key values as "label value" pairs, actions in a "…" sheet.
 */
export const ADMIN_TABLE_DESKTOP_CLASS = 'relative overflow-x-auto max-md:hidden'

export type AdminCardField = { label: string; value: ReactNode }

export function AdminMobileList({ label, children }: { label: string; children: ReactNode }) {
  return (
    <ul aria-label={label} className="divide-y divide-mist-100 md:hidden">
      {children}
    </ul>
  )
}

export function AdminMobileCard({
  title,
  href,
  subtitle,
  leading,
  badges,
  fields = [],
  actions = [],
  actionsLabel,
  note,
}: {
  title: string
  /** Where tapping the name goes (usually the record's admin page). */
  href?: string | null
  subtitle?: ReactNode
  /** Avatar or logo. */
  leading?: ReactNode
  badges?: ReactNode
  fields?: AdminCardField[]
  actions?: PageAction[]
  /** Accessible name of the "…" button, e.g. "Actions for Asha Singh". */
  actionsLabel?: string
  /** Free text under the fields (e.g. audit details), full width. */
  note?: ReactNode
}) {
  return (
    <li className="flex gap-3 px-4 py-3">
      {leading ? <div className="shrink-0 pt-0.5">{leading}</div> : null}
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[15px] font-semibold text-navy-950">
              {href ? (
                <Link href={href} className="min-w-0 break-words hover:text-ocean-700 hover:underline">{title}</Link>
              ) : (
                <span className="min-w-0 break-words">{title}</span>
              )}
              {badges}
            </p>
            {subtitle ? <div className="mt-0.5 truncate text-sm text-muted">{subtitle}</div> : null}
          </div>
          {actions.length ? (
            <PageActionsSheet
              label={actionsLabel ?? `Actions for ${title}`}
              title={title}
              actions={actions}
              triggerClassName="-mr-2 -mt-1.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
            />
          ) : null}
        </div>
        {fields.length ? (
          <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            {fields.map((field) => (
              <div key={field.label} className="flex min-w-0 items-baseline gap-1.5">
                <dt className="shrink-0 text-muted">{field.label}</dt>
                <dd className="min-w-0 truncate text-navy-950">{field.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {note ? <div className="mt-1.5 break-words text-sm leading-5 text-navy-900">{note}</div> : null}
      </div>
    </li>
  )
}
