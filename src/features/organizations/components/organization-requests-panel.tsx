'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { decideOrganizationAccessRequest } from '../access-request-actions'
import { ACCESS_ROLE_LABELS, accessRoleLabel, relativeDays } from '../access-request-labels'
import { ACCESS_REQUEST_ESCALATION_DAYS, requestAgeDays } from '../access-request-policy'
import type { ManagedAccessRequest } from '../access-request-repository'
import { COMPANY_ACCESS_REQUEST_ROLES, type CompanyAccessRequestRole } from '../types'
import { StatusChip } from './organization-access-panel'

function PendingRequest({
  request,
  nowIso,
  readOnly,
  onDecided,
}: {
  request: ManagedAccessRequest
  nowIso: string
  readOnly: boolean
  onDecided: (id: string, message: string) => void
}) {
  const [role, setRole] = useState<CompanyAccessRequestRole>(request.requestedRole)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const age = requestAgeDays(request.requestedAt, new Date(nowIso))
  const escalated = Boolean(request.escalatedAt)

  function decide(decision: 'approved' | 'rejected') {
    setError(null)
    startTransition(async () => {
      try {
        const result = await decideOrganizationAccessRequest({
          requestId: request.id,
          decision,
          grantedRole: decision === 'approved' ? role : null,
          note: note.trim() || null,
        })
        if (!result.ok) {
          setError(result.error)
          return
        }
        onDecided(request.id, decision === 'approved'
          ? `${request.requester.fullName} was approved as ${accessRoleLabel(role)}.`
          : `${request.requester.fullName}'s request was declined.`)
      } catch {
        setError('We could not save this decision. Check your connection and try again.')
      }
    })
  }

  return (
    <li
      className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && rejecting) {
          event.stopPropagation()
          setRejecting(false)
        }
      }}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          {request.requester.slug ? (
            <Link href={`/people/${request.requester.slug}`} className="font-semibold text-navy-950 hover:underline">{request.requester.fullName}</Link>
          ) : (
            <span className="font-semibold text-navy-950">{request.requester.fullName}</span>
          )}
          <StatusChip tone="neutral">Wants: {accessRoleLabel(request.requestedRole)}</StatusChip>
          {escalated ? <StatusChip tone="info">With Sea N Shore</StatusChip> : null}
          {!escalated && age >= ACCESS_REQUEST_ESCALATION_DAYS ? <StatusChip tone="warning">Waiting {age} days</StatusChip> : null}
        </p>
        {request.requester.headline ? <p className="mt-0.5 truncate text-sm text-muted">{request.requester.headline}</p> : null}
        <p className="mt-0.5 text-xs text-muted">Sent {relativeDays(request.requestedAt, nowIso)}</p>
        {request.message ? <p className="mt-2 rounded-lg bg-mist-50 px-3 py-2 text-sm leading-6 text-navy-900">{request.message}</p> : null}
        {escalated ? (
          <p className="mt-2 text-sm text-muted">
            The requester asked Sea N Shore to review this request, so Sea N Shore will decide it.
            {request.escalationNote ? <> Their message: &ldquo;{request.escalationNote}&rdquo;</> : null}
          </p>
        ) : null}
      </div>

      {readOnly || escalated ? null : (
        <div className="space-y-2">
          {rejecting ? (
            <>
              <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`reject-note-${request.id}`}>
                <span>Note to {request.requester.fullName} <span className="font-normal text-muted">(optional)</span></span>
                <textarea
                  id={`reject-note-${request.id}`}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  maxLength={4000}
                  autoFocus
                  placeholder="For example: we could not match you to our staff list."
                  className="min-h-20 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm font-normal"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={isPending} onClick={() => decide('rejected')} className="min-h-10 rounded-xl bg-red-700 px-4 text-sm font-bold text-white disabled:opacity-60 enabled:hover:bg-red-800 transition-colors disabled:cursor-not-allowed">
                  {isPending ? 'Saving…' : 'Confirm decline'}
                </button>
                <button type="button" disabled={isPending} onClick={() => setRejecting(false)} className="min-h-10 rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 enabled:hover:border-ocean-300 enabled:hover:bg-mist-50 transition-colors">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <label className="grid gap-1.5 text-sm font-semibold text-navy-900" htmlFor={`grant-role-${request.id}`}>
                Role to grant
                <select
                  id={`grant-role-${request.id}`}
                  value={role}
                  onChange={(event) => setRole(event.target.value as CompanyAccessRequestRole)}
                  className="min-h-10 rounded-xl border border-mist-100 bg-white px-3 text-sm font-normal"
                >
                  {COMPANY_ACCESS_REQUEST_ROLES.map((value) => <option key={value} value={value}>{ACCESS_ROLE_LABELS[value]}</option>)}
                </select>
              </label>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={isPending} onClick={() => decide('approved')} className="min-h-10 rounded-xl bg-emerald-700 px-4 text-sm font-bold text-white disabled:opacity-60 enabled:hover:bg-emerald-800 transition-colors disabled:cursor-not-allowed">
                  {isPending ? 'Saving…' : 'Approve'}
                </button>
                <button type="button" disabled={isPending} onClick={() => setRejecting(true)} className="min-h-10 rounded-xl border border-red-200 bg-white px-4 text-sm font-bold text-red-800 hover:bg-red-50">
                  Decline
                </button>
              </div>
            </>
          )}
          {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
        </div>
      )}
    </li>
  )
}

function decisionSummary(request: ManagedAccessRequest, nowIso: string) {
  const by = request.decidedVia === 'platform' ? 'Sea N Shore' : request.reviewerName ?? 'an administrator'
  if (request.status === 'approved') return `Approved as ${accessRoleLabel(request.grantedRole ?? request.requestedRole)} by ${by} ${relativeDays(request.reviewedAt, nowIso)}`
  if (request.status === 'rejected') return `Declined by ${by} ${relativeDays(request.reviewedAt, nowIso)}`
  return `Withdrawn by the requester ${relativeDays(request.reviewedAt, nowIso)}`
}

/**
 * The "Requests" section for an organization's owner and administrators.
 * Platform administrators who are not members see it read-only.
 */
export function OrganizationRequestsPanel({
  organizationName,
  requests,
  nowIso,
  readOnly = false,
}: {
  organizationName: string
  requests: ManagedAccessRequest[]
  nowIso: string
  readOnly?: boolean
}) {
  const router = useRouter()
  const [decided, setDecided] = useState<Record<string, string>>({})
  const pending = requests.filter((request) => request.status === 'pending' && !decided[request.id])
  const history = requests.filter((request) => request.status !== 'pending').slice(0, 20)
  const confirmations = Object.values(decided)

  return (
    <section id="requests" aria-labelledby="requests-heading" className="overflow-hidden rounded-xl border border-mist-100 bg-white scroll-mt-24">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-mist-100 px-4 py-3">
        <div>
          <h2 id="requests-heading" className="text-lg font-bold text-navy-950">
            Requests <span className="text-sm font-medium text-muted">{pending.length} waiting</span>
          </h2>
          <p className="text-sm text-muted">
            {readOnly
              ? `Read-only: the owner and administrators of ${organizationName} decide these requests.`
              : `People asking to join ${organizationName}. You choose the role they get.`}
          </p>
        </div>
      </header>

      {confirmations.length ? (
        <div role="status" className="border-b border-mist-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {confirmations[confirmations.length - 1]}
        </div>
      ) : null}

      {pending.length ? (
        <ul className="divide-y divide-mist-100">
          {pending.map((request) => (
            <PendingRequest
              key={request.id}
              request={request}
              nowIso={nowIso}
              readOnly={readOnly}
              onDecided={(id, message) => {
                setDecided((current) => ({ ...current, [id]: message }))
                router.refresh()
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="px-4 py-6 text-center text-sm text-muted">No requests are waiting. New requests to join {organizationName} appear here.</p>
      )}

      {history.length ? (
        <details className="border-t border-mist-100">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-navy-950 hover:bg-mist-50">Recent decisions ({history.length})</summary>
          <ul className="divide-y divide-mist-100 border-t border-mist-100">
            {history.map((request) => (
              <li key={request.id} className="px-4 py-2.5 text-sm">
                <span className="font-semibold text-navy-950">{request.requester.fullName}</span>
                <span className="text-muted"> · {decisionSummary(request, nowIso)}</span>
                {request.reviewerNote ? <p className="mt-0.5 text-xs text-muted">Note: {request.reviewerNote}</p> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  )
}
