'use client'

import { useEffect, useId, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2 } from 'lucide-react'
import { requestOrganizationAccess } from '../actions'
import { ACCESS_ROLE_LABELS, REQUESTABLE_ROLE_DESCRIPTIONS } from '../access-request-labels'
import { COMPANY_ACCESS_REQUEST_ROLES, type CompanyAccessRequestRole } from '../types'

export type RequestAccessState = 'none' | 'pending' | 'member'

/**
 * Inline "Request access" control for one organization. The request goes to the
 * organization's owner and administrators; Sea N Shore only steps in as a fallback.
 */
export function RequestAccessForm({
  company,
  initialState = 'none',
  compact = false,
}: {
  company: { id: string; name: string }
  initialState?: RequestAccessState
  compact?: boolean
}) {
  const router = useRouter()
  const id = useId()
  const openerRef = useRef<HTMLButtonElement>(null)
  const [localState, setState] = useState<RequestAccessState>(initialState)
  // Server state wins when it moves forward (for example a refresh after approval).
  const rank: Record<RequestAccessState, number> = { none: 0, pending: 1, member: 2 }
  const state = rank[initialState] > rank[localState] ? initialState : localState
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<CompanyAccessRequestRole>('member')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()
  const restoreFocus = useRef(false)
  const roleRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    if (open) {
      roleRef.current?.focus()
    } else if (restoreFocus.current) {
      restoreFocus.current = false
      openerRef.current?.focus()
    }
  }, [open])

  if (state === 'member') {
    return <span className="inline-flex min-h-9 items-center rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-800">You are a member</span>
  }

  if (state === 'pending') {
    return (
      <div className="space-y-1">
        <span className="inline-flex min-h-9 items-center rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-900">Request waiting for a decision</span>
        {sent ? (
          <p role="status" className="flex items-start gap-1.5 text-xs leading-5 text-emerald-800">
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
            Sent to the owner and administrators of {company.name}. Their decision appears under &ldquo;Your requests&rdquo;.
          </p>
        ) : null}
      </div>
    )
  }

  function close() {
    restoreFocus.current = true
    setOpen(false)
    setError(null)
  }

  function submit() {
    setError(null)
    startTransition(async () => {
      try {
        const result = await requestOrganizationAccess(company.id, role, message)
        if (!result.ok) {
          setError(result.error)
          return
        }
        setSent(true)
        setState('pending')
        setOpen(false)
        router.refresh()
      } catch {
        setError('We could not send the request. Check your connection and try again.')
      }
    })
  }

  if (!open) {
    return (
      <button
        ref={openerRef}
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className={compact
          ? 'inline-flex min-h-9 items-center rounded-lg bg-navy-950 px-3 text-xs font-bold text-white transition hover:bg-navy-900'
          : 'inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900'}
      >
        Request access
      </button>
    )
  }

  return (
    <div
      className="w-full space-y-3 rounded-xl border border-ocean-200 bg-ocean-50/40 p-3 sm:p-4"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation()
          close()
        }
      }}
    >
      <p className="text-sm font-semibold text-navy-950">Request access to {company.name}</p>
      <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`${id}-role`}>
        Role you need
        <select
          ref={roleRef}
          id={`${id}-role`}
          value={role}
          onChange={(event) => setRole(event.target.value as CompanyAccessRequestRole)}
          aria-describedby={`${id}-role-hint`}
          className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm font-normal"
        >
          {COMPANY_ACCESS_REQUEST_ROLES.map((value) => (
            <option key={value} value={value}>{ACCESS_ROLE_LABELS[value]}</option>
          ))}
        </select>
        <span id={`${id}-role-hint`} className="text-xs font-normal text-muted">{REQUESTABLE_ROLE_DESCRIPTIONS[role]}</span>
      </label>
      <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`${id}-message`}>
        <span>Message to the organization&apos;s admins <span className="font-normal text-muted">(optional)</span></span>
        <textarea
          id={`${id}-message`}
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          maxLength={2000}
          placeholder="How you are connected, for example your job title and team."
          className="min-h-20 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-normal"
        />
      </label>
      <p className="text-xs leading-5 text-muted">
        The owner and administrators of {company.name} decide. If nobody responds within 7 days, you can ask Sea N Shore to step in.
      </p>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={isPending}
          className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white disabled:opacity-60 enabled:hover:bg-navy-800 transition-colors disabled:cursor-not-allowed"
        >
          {isPending ? 'Sending…' : 'Send request'}
        </button>
        <button
          type="button"
          onClick={close}
          disabled={isPending}
          className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 enabled:hover:border-ocean-300 enabled:hover:bg-mist-50 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
