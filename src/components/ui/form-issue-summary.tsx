'use client'

import { forwardRef } from 'react'

export type FormIssueLink = {
  /** The id of the field the link jumps to. */
  fieldId: string
  label: string
  message: string
}

/**
 * Fields scroll into view below the sticky phone header and page bar (about 7rem together), with room
 * for the field's label. Put this class on the form.
 */
export const FORM_FIELD_SCROLL_MARGIN_CLASS = '[&_:is(input,select,textarea,fieldset)]:scroll-mt-36 md:[&_:is(input,select,textarea,fieldset)]:scroll-mt-24'

/** Focuses a field and scrolls it to just below the sticky header (see FORM_FIELD_SCROLL_MARGIN_CLASS). */
export function focusFormField(element: HTMLElement | null | undefined) {
  if (!element) return
  element.focus({ preventScroll: true })
  if (typeof element.scrollIntoView === 'function') {
    const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    element.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' })
  }
}

/**
 * Hotfix P2: "2 things to fix" at the top of a form, each linking to its field. `tone="error"` after a
 * blocked save; `tone="checklist"` for what is left before publishing a saved draft.
 */
export const FormIssueSummary = forwardRef<HTMLDivElement, {
  id: string
  title: string
  issues: FormIssueLink[]
  tone: 'error' | 'checklist'
  intro?: string | null
}>(function FormIssueSummary({ id, title, issues, tone, intro }, ref) {
  if (!issues.length && !intro) return null
  const error = tone === 'error'
  return (
    <div
      ref={ref}
      id={id}
      role={error ? 'alert' : 'status'}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      className={`rounded-2xl border px-4 py-4 text-sm outline-none focus-visible:ring-2 ${
        error ? 'border-red-200 bg-red-50 text-red-900 focus-visible:ring-red-300' : 'border-amber-200 bg-amber-50 text-amber-950 focus-visible:ring-amber-300'
      }`}
    >
      <p id={`${id}-title`} className="font-bold">{title}</p>
      {intro ? <p className="mt-1 leading-6">{intro}</p> : null}
      {issues.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {issues.map((issue) => (
            <li key={`${issue.fieldId}:${issue.message}`}>
              <a
                href={`#${issue.fieldId}`}
                onClick={(event) => {
                  event.preventDefault()
                  focusFormField(document.getElementById(issue.fieldId))
                }}
                className={`font-semibold underline underline-offset-2 ${error ? 'text-red-800 hover:text-red-950' : 'text-amber-900 hover:text-amber-950'}`}
              >
                {issue.label}
              </a>
              : {issue.message}
            </li>
          ))}
        </ul>
      ) : null}
      {error ? <p className="mt-2 text-xs leading-5 text-red-800">Everything you typed is kept. Fix these and try again.</p> : null}
    </div>
  )
})
