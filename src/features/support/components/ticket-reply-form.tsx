'use client'

import { useActionState, useEffect, useId, useRef } from 'react'
import { SUPPORT_MESSAGE_MAX } from '../topics'
import { supportInputClass, supportPrimaryButtonClass } from './form-styles'

export type TicketReplyFormState = {
  status: 'idle' | 'success' | 'error'
  message?: string
  fieldError?: string
  body?: string
}

/**
 * Round H (H7): the reply box on a ticket, for the member (Help › My requests) and for administrators
 * (Admin › Support). The field has a label; its error is linked with aria-describedby and takes focus.
 * A sent reply clears the box and is announced.
 */
export function TicketReplyForm({
  action,
  label,
  hint,
  submitLabel,
}: {
  action: (state: TicketReplyFormState, formData: FormData) => Promise<TicketReplyFormState>
  label: string
  hint?: string
  submitLabel: string
}) {
  const [state, formAction, pending] = useActionState<TicketReplyFormState, FormData>(action, { status: 'idle' })
  const id = useId()
  const fieldRef = useRef<HTMLTextAreaElement | null>(null)
  const formRef = useRef<HTMLFormElement | null>(null)

  useEffect(() => {
    if (state.status === 'error' && state.fieldError) fieldRef.current?.focus()
    if (state.status === 'success') formRef.current?.reset()
  }, [state])

  const describedBy = [state.fieldError ? `${id}-error` : null, hint ? `${id}-hint` : null].filter(Boolean).join(' ') || undefined

  return (
    <form ref={formRef} action={formAction} noValidate className="grid gap-3">
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-body`} className="text-sm font-semibold text-navy-950">{label}</label>
        <textarea
          ref={fieldRef}
          id={`${id}-body`}
          name="body"
          rows={5}
          required
          maxLength={SUPPORT_MESSAGE_MAX}
          defaultValue={state.status === 'error' ? state.body ?? '' : ''}
          key={state.status === 'success' ? `sent-${state.message}` : 'draft'}
          aria-invalid={Boolean(state.fieldError)}
          aria-describedby={describedBy}
          className={`${supportInputClass} min-h-32 py-2.5 leading-6`}
        />
        {state.fieldError ? <p id={`${id}-error`} className="text-sm text-red-700">{state.fieldError}</p> : null}
        {hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
      </div>
      <p role="status" aria-live="polite" className={state.status === 'success' ? 'text-sm font-semibold text-emerald-800' : 'sr-only'}>
        {state.status === 'success' ? state.message : ''}
      </p>
      {state.status === 'error' && state.message ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{state.message}</p> : null}
      <div>
        <button type="submit" disabled={pending} className={`${supportPrimaryButtonClass} max-md:w-full`}>
          {pending ? 'Sending…' : submitLabel}
        </button>
      </div>
    </form>
  )
}
