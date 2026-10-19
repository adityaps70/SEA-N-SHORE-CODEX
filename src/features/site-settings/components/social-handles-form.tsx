'use client'

import { useActionState, useEffect, useId, useRef } from 'react'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { supportInputClass, supportPrimaryButtonClass } from '@/features/support/components/form-styles'
import { saveSocialHandlesAction, type SiteSettingsFormState } from '../admin-actions'
import { SOCIAL_HANDLE_LABELS, SOCIAL_HANDLE_NETWORKS, type SocialHandles } from '../schemas'

/**
 * Round I (I1): Admin › Site settings › Social handles. Shown in the footer of job share images; an empty handle
 * leaves that network out. Handles only, never a personal phone number or email.
 */
export function SocialHandlesForm({ initial }: { initial: SocialHandles }) {
  const [state, formAction, pending] = useActionState<SiteSettingsFormState<SocialHandles>, FormData>(saveSocialHandlesAction, { status: 'idle' })
  const id = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  const values = state.values ?? initial
  const errors = state.fieldErrors ?? {}

  useEffect(() => {
    if (state.status === 'error') focusFirstFormError(formRef.current)
  }, [state])

  return (
    <form ref={formRef} action={formAction} noValidate className="grid gap-4">
      {state.status === 'error' ? (
        <FormErrorSummary
          error={Object.keys(errors).length ? null : state.message}
          fieldErrors={Object.fromEntries(Object.entries(errors).map(([key, message]) => [key, [message]]))}
          fieldLabels={SOCIAL_HANDLE_LABELS}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {SOCIAL_HANDLE_NETWORKS.map((network) => (
          <div key={network} className="grid gap-1.5">
            <label htmlFor={`${id}-${network}`} className="text-sm font-medium text-navy-900">{SOCIAL_HANDLE_LABELS[network]}</label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">@</span>
              <input
                id={`${id}-${network}`}
                name={network}
                type="text"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={61}
                defaultValue={values[network]}
                key={`${network}-${state.status}-${values[network]}`}
                aria-invalid={Boolean(errors[network])}
                aria-describedby={errors[network] ? `${id}-${network}-error` : `${id}-hint`}
                className={`${supportInputClass} pl-7`}
              />
            </div>
            {errors[network] ? <p id={`${id}-${network}-error`} className="text-sm text-red-700">{errors[network]}</p> : null}
          </div>
        ))}
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted">The handle only, without the web address, for example seaandshore.in. Leave a network empty to leave it out.</p>
      <p role="status" aria-live="polite" className={state.status === 'success' ? 'text-sm font-semibold text-emerald-800' : 'sr-only'}>
        {state.status === 'success' ? state.message : ''}
      </p>
      <div>
        <button type="submit" disabled={pending} className={`${supportPrimaryButtonClass} max-md:w-full`}>
          {pending ? 'Saving…' : 'Save social handles'}
        </button>
      </div>
    </form>
  )
}
