'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { escalateOrganizationAccessRequest, withdrawOrganizationAccessRequest } from '../access-request-actions'
import { accessRoleLabel, relativeDays } from '../access-request-labels'
import { escalationEligibility } from '../access-request-policy'
import type { CompanyAccessRequestSummary } from '../types'

type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

const toneClasses: Record<Tone, string> = {
  neutral: 'border-mist-200 bg-mist-50 text-navy-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-800',
  info: 'border-ocean-200 bg-ocean-50 text-ocean-800',
}

export function StatusChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-2 py-0.5 text-xs font-semibold ${toneClasses[tone]}`}>
      {children}
    </span>
  )
}

/** What the requester sees about the state of their request. */
export function requesterStatus(request: CompanyAccessRequestSummary, nowIso: string): { tone: Tone; label: string; detail: string } {
  const org = request.company.name
  if (request.status === 'approved') {
    return {
      tone: 'success',
      label: `Approved as ${accessRoleLabel(request.grantedRole ?? request.requestedRole)}`,
      detail: request.decidedVia === 'platform' ? `Approved by Sea N Shore ${relativeDays(request.reviewedAt, nowIso)}.` : `Approved by ${org} ${relativeDays(request.reviewedAt, nowIso)}.`,
    }
  }
  if (request.status === 'rejected') {
    return {
      tone: 'danger',
      label: 'Not approved',
      detail: request.decidedVia === 'platform'
        ? `Sea N Shore reviewed this request ${relativeDays(request.reviewedAt, nowIso)} and did not approve it.`
        : `${org} did not approve this request ${relativeDays(request.reviewedAt, nowIso)}.`,
    }
  }
  if (request.status === 'cancelled') {
    return { tone: 'neutral', label: 'Withdrawn', detail: 'You withdrew this request.' }
  }
  if (request.escalatedAt) {
    return {
      tone: 'info',
      label: 'With Sea N Shore',
      detail: `You asked Sea N Shore to review this ${relativeDays(request.escalatedAt, nowIso)}. We will update the status here.`,
    }
  }
  return {
    tone: 'warning',
    label: 'Waiting for the organization',
    detail: `Sent ${relativeDays(request.requestedAt, nowIso)} to the owner and administrators of ${org}.`,
  }
}

function RequestRow({ request, nowIso }: { request: CompanyAccessRequestSummary; nowIso: string }) {
  const router = useRouter()
  const [mode, setMode] = useState<'idle' | 'withdraw' | 'escalate'>('idle')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const status = requesterStatus(request, nowIso)
  const escalation = escalationEligibility({
    status: request.status,
    requesterId: 'self',
    actorId: 'self',
    requestedAt: request.requestedAt,
    escalatedAt: request.escalatedAt,
    decidedVia: request.decidedVia,
    now: new Date(nowIso),
  })

  function run(work: () => Promise<{ ok: true } | { ok: false; error: string }>, success: string) {
    setError(null)
    startTransition(async () => {
      try {
        const result = await work()
        if (!result.ok) {
          setError(result.error)
          return
        }
        setDone(success)
        setMode('idle')
        setNote('')
        router.refresh()
      } catch {
        setError('We could not save this change. Check your connection and try again.')
      }
    })
  }

  return (
    <li className="px-4 py-3" onKeyDown={(event) => {
      if (event.key === 'Escape' && mode !== 'idle') {
        event.stopPropagation()
        setMode('idle')
        setError(null)
      }
    }}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={`/organizations/${request.company.slug}`} className="font-semibold text-navy-950 hover:underline">{request.company.name}</Link>
            <StatusChip tone={status.tone}>{status.label}</StatusChip>
          </p>
          <p className="mt-0.5 text-sm text-muted">Requested: {accessRoleLabel(request.requestedRole)} · {status.detail}</p>
          {request.reviewerNote && request.status !== 'cancelled' ? (
            <p className="mt-1 text-sm text-navy-900"><span className="font-semibold">Note from the reviewer:</span> {request.reviewerNote}</p>
          ) : null}
          {request.escalationNote && request.escalatedAt ? (
            <p className="mt-1 text-sm text-muted"><span className="font-semibold text-navy-900">Your message to Sea N Shore:</span> {request.escalationNote}</p>
          ) : null}
        </div>
        {mode === 'idle' ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            {request.status === 'approved' ? (
              <Link href={`/organizations/${request.company.slug}`} className="inline-flex min-h-9 items-center rounded-lg border border-mist-100 px-3 text-xs font-semibold text-navy-950 hover:bg-mist-50">Open workspace</Link>
            ) : null}
            {escalation.allowed ? (
              <button type="button" onClick={() => setMode('escalate')} className="inline-flex min-h-9 items-center rounded-lg border border-ocean-200 bg-ocean-50 px-3 text-xs font-semibold text-ocean-800 hover:bg-ocean-100">
                {escalation.kind === 'after_rejection' ? 'Ask Sea N Shore to review' : 'Ask Sea N Shore to step in'}
              </button>
            ) : null}
            {request.status === 'pending' ? (
              <button type="button" onClick={() => setMode('withdraw')} className="inline-flex min-h-9 items-center rounded-lg border border-mist-100 px-3 text-xs font-semibold text-navy-950 hover:bg-mist-50">Withdraw</button>
            ) : null}
          </div>
        ) : null}
      </div>

      {mode === 'withdraw' ? (
        <div className="mt-3 flex flex-col gap-2 rounded-lg border border-mist-100 bg-mist-50 p-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-navy-900">Withdraw your request to {request.company.name}?</p>
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={() => run(() => withdrawOrganizationAccessRequest(request.id), 'Request withdrawn.')} className="min-h-9 rounded-lg bg-navy-950 px-3 text-xs font-bold text-white disabled:opacity-60">
              {isPending ? 'Withdrawing…' : 'Yes, withdraw'}
            </button>
            <button type="button" disabled={isPending} onClick={() => setMode('idle')} className="min-h-9 rounded-lg border border-mist-100 bg-white px-3 text-xs font-bold text-navy-950">Keep request</button>
          </div>
        </div>
      ) : null}

      {mode === 'escalate' ? (
        <div className="mt-3 space-y-2 rounded-lg border border-ocean-100 bg-ocean-50/40 p-3">
          <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`escalate-${request.id}`}>
            What should Sea N Shore know?
            <textarea
              id={`escalate-${request.id}`}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={2000}
              autoFocus
              placeholder={escalation.allowed && escalation.kind === 'after_rejection'
                ? 'Why you think the decision should be reviewed, for example proof of your employment.'
                : 'How you are connected to the organization and anything you have tried already.'}
              className="min-h-20 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-normal"
            />
          </label>
          <p className="text-xs text-muted">Sea N Shore reviews escalated requests and its decision is final.</p>
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={() => run(() => escalateOrganizationAccessRequest(request.id, note), 'Sent to Sea N Shore. We will update the status here.')} className="min-h-9 rounded-lg bg-navy-950 px-3 text-xs font-bold text-white disabled:opacity-60">
              {isPending ? 'Sending…' : 'Send to Sea N Shore'}
            </button>
            <button type="button" disabled={isPending} onClick={() => { setMode('idle'); setError(null) }} className="min-h-9 rounded-lg border border-mist-100 bg-white px-3 text-xs font-bold text-navy-950">Cancel</button>
          </div>
        </div>
      ) : null}

      {error ? <p role="alert" className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {done ? <p role="status" className="mt-2 text-sm text-emerald-800">{done}</p> : null}
    </li>
  )
}

/** The requester's own organization access requests, with status, withdraw and escalation. */
export function OrganizationAccessPanel({
  initialRequests,
  nowIso,
}: {
  initialRequests: CompanyAccessRequestSummary[]
  nowIso: string
}) {
  if (!initialRequests.length) return null
  return (
    <ul className="divide-y divide-mist-100" aria-label="Your organization access requests">
      {initialRequests.map((request) => <RequestRow key={request.id} request={request} nowIso={nowIso} />)}
    </ul>
  )
}
