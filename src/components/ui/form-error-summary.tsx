'use client'

type FieldErrors = Record<string, string[] | undefined>

function errorEntries(fieldErrors?: FieldErrors, fieldLabels?: Record<string, string>) {
  if (!fieldErrors) return []
  return Object.entries(fieldErrors).flatMap(([field, messages]) =>
    (messages ?? []).map((message) => ({
      key: `${field}:${message}`,
      label: fieldLabels?.[field],
      message,
    })),
  )
}

export function hasFormErrors(error?: string | null, fieldErrors?: FieldErrors) {
  return Boolean(error || errorEntries(fieldErrors).length)
}

export function FormErrorSummary({
  error,
  fieldErrors,
  fieldLabels,
}: {
  error?: string | null
  fieldErrors?: FieldErrors
  fieldLabels?: Record<string, string>
}) {
  const entries = errorEntries(fieldErrors, fieldLabels)
  if (!error && entries.length === 0) return null

  return (
    <div
      role="alert"
      tabIndex={-1}
      data-form-error-summary="true"
      className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-900 outline-none focus:ring-2 focus:ring-red-300"
    >
      <p className="font-semibold">
        {entries.length ? 'Please correct the highlighted information' : 'We could not complete this step'}
      </p>
      {error ? <p className="mt-1 leading-6">{error}</p> : null}
      {entries.length ? (
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {entries.map((entry) => (
            <li key={entry.key}>
              {entry.label ? <span className="font-semibold">{entry.label}: </span> : null}
              {entry.message}
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs leading-5 text-red-800">
        Your information has been kept. Correct the highlighted area and try again.
      </p>
    </div>
  )
}

export function focusFirstFormError(form: HTMLFormElement | null) {
  if (!form) return
  const target =
    form.querySelector<HTMLElement>('[aria-invalid="true"]')
    ?? form.querySelector<HTMLElement>('[data-form-error-target="true"]')
    ?? form.querySelector<HTMLElement>('[data-form-error-summary="true"]')

  if (!target) return
  target.focus({ preventScroll: true })
  if (typeof target.scrollIntoView === 'function') {
    target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }
}
