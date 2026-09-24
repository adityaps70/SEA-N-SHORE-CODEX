'use client'

import { useState, useTransition } from 'react'
import { Building2, CheckCircle2, Search, ShieldCheck } from 'lucide-react'
import { requestOrganizationAccess, searchOrganizations } from '../actions'
import type {
  CompanyAccessRequestRole,
  CompanyAccessRequestSummary,
  CompanySearchResult,
} from '../types'

const roleLabels: Record<CompanyAccessRequestRole, string> = {
  member: 'Member / employee',
  recruiter: 'Recruiter / HR',
  administrator: 'Organization administrator',
}

function requestStatusLabel(status: CompanyAccessRequestSummary['status']) {
  if (status === 'approved') return 'Approved'
  if (status === 'rejected') return 'Rejected'
  if (status === 'cancelled') return 'Cancelled'
  return 'Pending review'
}

export function OrganizationAccessPanel({
  initialRequests,
}: {
  initialRequests: CompanyAccessRequestSummary[]
}) {
  const [isPending, startTransition] = useTransition()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<CompanySearchResult[]>([])
  const [selected, setSelected] = useState<CompanySearchResult | null>(null)
  const [role, setRole] = useState<CompanyAccessRequestRole>('member')
  const [message, setMessage] = useState('')
  const [feedback, setFeedback] = useState<string | null>(null)
  const [requests, setRequests] = useState(initialRequests)

  function runSearch() {
    setFeedback(null)
    startTransition(async () => {
      const result = await searchOrganizations(term)
      if (!result.ok) {
        setResults([])
        setFeedback(result.error)
        return
      }
      setResults(result.organizations)
      setFeedback(result.organizations.length ? null : 'No matching organization found. You can create a new organization below.')
    })
  }

  function submitRequest() {
    if (!selected) return
    setFeedback(null)
    startTransition(async () => {
      const result = await requestOrganizationAccess(selected.id, role, message)
      if (!result.ok) {
        setFeedback(result.error)
        return
      }

      setRequests((current) => [{
        id: result.requestId,
        status: 'pending',
        requestedRole: role,
        requestType: role === 'member' ? 'join_company' : 'recruiter_access',
        message: message.trim() || null,
        requestedAt: new Date().toISOString(),
        reviewedAt: null,
        reviewerNote: null,
        company: {
          id: selected.id,
          slug: selected.slug,
          name: selected.name,
          verified: selected.verified,
        },
      }, ...current])
      setFeedback('Access request submitted for Sea N Shore review.')
      setSelected(null)
      setMessage('')
      setRole('member')
    })
  }

  return (
    <section className="space-y-5 rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Search aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Existing organization</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Find or claim an organization</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Search first so Sea N Shore does not create duplicate company pages. Access is reviewed before membership is granted.
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              runSearch()
            }
          }}
          aria-label="Search existing organizations"
          placeholder="Search company, institute or organization"
          className="min-h-11 flex-1 rounded-xl border border-mist-100 bg-white px-4 text-sm text-navy-950 outline-none focus:border-ocean-500 focus:ring-2 focus:ring-ocean-100"
        />
        <button
          type="button"
          onClick={runSearch}
          disabled={isPending || term.trim().length < 2}
          className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isPending ? 'Searching…' : 'Search'}
        </button>
      </div>

      {results.length ? (
        <div className="grid gap-2">
          {results.map((company) => (
            <button
              type="button"
              key={company.id}
              onClick={() => {
                setSelected(company)
                setFeedback(null)
              }}
              className="flex items-start justify-between gap-4 rounded-xl border border-mist-100 bg-mist-50/40 p-4 text-left transition hover:border-ocean-300 hover:bg-ocean-50/40"
            >
              <span>
                <span className="flex flex-wrap items-center gap-2 font-bold text-navy-950">
                  {company.name}
                  {company.verified ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                      <ShieldCheck aria-hidden="true" className="size-3" /> Verified
                    </span>
                  ) : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-muted">
                  {company.companyType ?? 'Maritime organization'}{company.website ? ` · ${company.website}` : ''}
                </span>
              </span>
              <span className="text-xs font-bold text-ocean-700">Request access</span>
            </button>
          ))}
        </div>
      ) : null}

      {selected ? (
        <div className="rounded-2xl border border-ocean-200 bg-ocean-50/50 p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-white text-ocean-700">
              <Building2 aria-hidden="true" className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-bold text-navy-950">{selected.name}</p>
              <p className="mt-1 text-xs text-muted">Choose the access that matches what you actually do for this organization.</p>

              <label className="mt-4 grid gap-1.5 text-sm font-semibold text-navy-900">
                Requested role
                <select
                  value={role}
                  onChange={(event) => setRole(event.target.value as CompanyAccessRequestRole)}
                  className="min-h-11 rounded-xl border border-mist-100 bg-white px-3 text-sm"
                >
                  {Object.entries(roleLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </label>

              <label className="mt-3 grid gap-1.5 text-sm font-semibold text-navy-900">
                Verification note <span className="font-normal text-muted">(optional)</span>
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  maxLength={2000}
                  placeholder="Explain your relationship with the organization."
                  className="min-h-24 rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm"
                />
              </label>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={submitRequest}
                  disabled={isPending}
                  className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white disabled:opacity-50"
                >
                  {isPending ? 'Submitting…' : 'Submit access request'}
                </button>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  className="min-h-10 rounded-xl border border-mist-100 bg-white px-4 text-sm font-bold text-navy-950"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {feedback ? <p role="status" className="rounded-xl bg-mist-50 px-4 py-3 text-sm text-navy-900">{feedback}</p> : null}

      {requests.length ? (
        <div className="border-t border-mist-100 pt-5">
          <h3 className="font-bold text-navy-950">Your organization access requests</h3>
          <div className="mt-3 grid gap-2">
            {requests.map((request) => (
              <article key={request.id} className="rounded-xl border border-mist-100 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-semibold text-navy-950">{request.company.name}</p>
                    <p className="mt-1 text-xs text-muted">{roleLabels[request.requestedRole]}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                    request.status === 'approved'
                      ? 'bg-emerald-50 text-emerald-800'
                      : request.status === 'rejected'
                        ? 'bg-red-50 text-red-800'
                        : 'bg-amber-50 text-amber-800'
                  }`}>
                    {requestStatusLabel(request.status)}
                  </span>
                </div>
                {request.reviewerNote ? <p className="mt-3 text-sm text-muted">Review note: {request.reviewerNote}</p> : null}
                {request.status === 'approved' ? (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-bold text-emerald-800">
                    <CheckCircle2 aria-hidden="true" className="size-4" /> Membership approved
                  </p>
                ) : null}
              </article>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
