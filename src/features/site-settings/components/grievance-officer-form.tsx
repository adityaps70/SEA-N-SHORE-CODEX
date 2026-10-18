'use client'

import { useActionState, useEffect, useId, useRef } from 'react'
import { FormErrorSummary, focusFirstFormError } from '@/components/ui/form-error-summary'
import { supportInputClass, supportPrimaryButtonClass } from '@/features/support/components/form-styles'
import { saveGrievanceOfficerAction, type SiteSettingsFormState } from '../admin-actions'
import type { GrievanceOfficer } from '../schemas'

const LABELS: Record<keyof GrievanceOfficer, string> = { name: 'Name', email: 'Email address', responseTime: 'Response time' }

/**
 * Round H (H7): Admin › Site settings › Grievance Officer. Leave every field empty until an officer is
 * appointed: the Contact page then says one is being appointed and gives the support email.
 */
export function GrievanceOfficerForm({ initial }: { initial: GrievanceOfficer }) {
  const [state, formAction, pending] = useActionState<SiteSettingsFormState<GrievanceOfficer>, FormData>(saveGrievanceOfficerAction, { status: 'idle' })
  const id = useId()
  const formRef = useRef<HTMLFormElement | null>(null)
  const values = state.values ?? initial
  const errors = state.fieldErrors ?? {}

  useEffect(() => {
    if (state.status === 'error') focusFirstFormError(formRef.current)
  }, [state])

  const field = (name: keyof GrievanceOfficer, input: { type?: string; autoComplete?: string; hint?: string; maxLength: number }) => {
    const describedBy = [errors[name] ? `${id}-${name}-error` : null, input.hint ? `${id}-${name}-hint` : null].filter(Boolean).join(' ') || undefined
    return (
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-${name}`} className="text-sm font-medium text-navy-900">{LABELS[name]}</label>
        <input
          id={`${id}-${name}`}
          name={name}
          type={input.type ?? 'text'}
          autoComplete={input.autoComplete ?? 'off'}
          maxLength={input.maxLength}
          defaultValue={values[name]}
          key={`${name}-${state.status}-${values[name]}`}
          aria-invalid={Boolean(errors[name])}
          aria-describedby={describedBy}
          className={supportInputClass}
        />
        {errors[name] ? <p id={`${id}-${name}-error`} className="text-sm text-red-700">{errors[name]}</p> : null}
        {input.hint ? <p id={`${id}-${name}-hint`} className="text-xs text-muted">{input.hint}</p> : null}
      </div>
    )
  }

  return (
    <form ref={formRef} action={formAction} noValidate className="grid gap-4">
      {state.status === 'error' ? (
        <FormErrorSummary
          error={Object.keys(errors).length ? null : state.message}
          fieldErrors={Object.fromEntries(Object.entries(errors).map(([key, message]) => [key, [message]]))}
          fieldLabels={LABELS}
        />
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('name', { maxLength: 120 })}
        {field('email', { type: 'email', maxLength: 254 })}
      </div>
      {field('responseTime', { maxLength: 120, hint: 'For example: "We acknowledge within 24 hours and resolve within 15 days." Leave empty to leave it out.' })}
      <p role="status" aria-live="polite" className={state.status === 'success' ? 'text-sm font-semibold text-emerald-800' : 'sr-only'}>
        {state.status === 'success' ? state.message : ''}
      </p>
      <div>
        <button type="submit" disabled={pending} className={`${supportPrimaryButtonClass} max-md:w-full`}>
          {pending ? 'Saving…' : 'Save Grievance Officer'}
        </button>
      </div>
    </form>
  )
}
