'use client'

import { Building2, Search, UserRound, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from 'react'
import { iconButtonClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui/interactive-styles'
import { removeFeeOverrideAction, searchSellersAction, setFeeOverrideAction } from '../../admin-actions'
import type { SellerSearchResult } from '../../payout-queries'
import { adminInputClass } from './fee-settings-form'

export type FeeOverrideView = {
  key: string
  name: string
  kind: 'profile' | 'organization'
  percentLabel: string
  note: string | null
  updatedLabel: string
}

type Selected = { key: string; name: string; kind: 'profile' | 'organization' }

function KindIcon({ kind }: { kind: 'profile' | 'organization' }) {
  return kind === 'organization'
    ? <Building2 aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
    : <UserRound aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
}

function RemoveOverrideButton({ override }: { override: FeeOverrideView }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const openRef = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  useEffect(() => {
    if (confirming) confirmRef.current?.focus()
    else if (refocus.current) {
      refocus.current = false
      openRef.current?.focus()
    }
  }, [confirming])

  function cancel() {
    if (pending) return
    refocus.current = true
    setConfirming(false)
    setError(null)
  }

  async function remove() {
    setPending(true)
    setError(null)
    let result: Awaited<ReturnType<typeof removeFeeOverrideAction>>
    try {
      result = await removeFeeOverrideAction(override.key)
    } catch {
      result = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was changed. Try again." }
    }
    setPending(false)
    if (result.ok) {
      setConfirming(false)
      startTransition(() => router.refresh())
      return
    }
    setError(result.error)
  }

  if (!confirming) {
    return (
      <button ref={openRef} type="button" onClick={() => setConfirming(true)} className={`${secondaryButtonClass} min-h-9 px-3 text-xs`}>
        Remove rate
      </button>
    )
  }
  return (
    <div role="group" aria-label={`Remove the ${override.percentLabel} rate for ${override.name}?`} onKeyDown={(event) => { if (event.key === 'Escape') cancel() }} className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/60 p-3 text-left sm:max-w-xs">
      <p className="text-sm font-semibold text-navy-950">Put {override.name} back on the default fee?</p>
      <p className="text-xs leading-5 text-navy-800">Applies to new sales. Past sales keep {override.percentLabel}.</p>
      {error ? <p role="alert" className="text-xs font-semibold text-red-700">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button ref={confirmRef} type="button" onClick={() => { void remove() }} disabled={pending} aria-busy={pending || undefined} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg bg-rose-700 px-3 text-xs font-bold text-white transition hover:bg-rose-800 disabled:cursor-not-allowed disabled:opacity-60">
          {pending ? 'Removing…' : 'Yes, use default'}
        </button>
        <button type="button" onClick={cancel} disabled={pending} className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-xs font-bold text-navy-900 transition hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60">
          Keep rate
        </button>
      </div>
    </div>
  )
}

/** Admin: find a person or organization and give them their own platform fee. */
export function FeeOverrideManager({ overrides, defaultPercentLabel }: { overrides: FeeOverrideView[]; defaultPercentLabel: string }) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<SellerSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Selected | null>(null)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const request = useRef(0)
  const percentRef = useRef<HTMLInputElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const id = useId()

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function changeTerm(value: string) {
    setTerm(value)
    if (timer.current) clearTimeout(timer.current)
    const current = ++request.current
    const text = value.trim()
    if (text.length < 2) {
      setResults([])
      setSearching(false)
      setSearchError(null)
      return
    }
    setSearching(true)
    timer.current = setTimeout(() => {
      searchSellersAction(text)
        .then((outcome) => {
          if (current !== request.current) return
          if (outcome.ok) {
            setResults(outcome.results)
            setSearchError(null)
          } else {
            setResults([])
            setSearchError(outcome.error)
          }
        })
        .catch(() => {
          if (current === request.current) setSearchError("Search isn't working right now. Please try again.")
        })
        .finally(() => {
          if (current === request.current) setSearching(false)
        })
    }, 300)
  }

  useEffect(() => {
    if (selected) percentRef.current?.focus()
  }, [selected])

  function choose(result: SellerSearchResult) {
    setSelected({ key: result.key, name: result.name, kind: result.kind })
    changeTerm('')
    setMessage(null)
    setFieldErrors({})
  }

  function clearSelection() {
    setSelected(null)
    setFieldErrors({})
    requestAnimationFrameSafe(() => searchRef.current?.focus())
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selected || pending) return
    const data = new FormData(event.currentTarget)
    setPending(true)
    setMessage(null)
    setFieldErrors({})
    let outcome: Awaited<ReturnType<typeof setFeeOverrideAction>>
    try {
      outcome = await setFeeOverrideAction({ sellerKey: selected.key, percent: String(data.get('percent') ?? ''), note: String(data.get('note') ?? '') })
    } catch {
      outcome = { ok: false, error: "We couldn't reach Sea N Shore. Nothing was saved. Try again." }
    }
    setPending(false)
    if (outcome.ok) {
      setMessage({ ok: true, text: outcome.message })
      setSelected(null)
      startTransition(() => router.refresh())
    } else {
      setMessage({ ok: false, text: outcome.error })
      setFieldErrors(outcome.fieldErrors ?? {})
    }
  }

  const showResults = term.trim().length >= 2

  return (
    <div className="divide-y divide-mist-100">
      <div className="space-y-3 p-5">
        {!selected ? (
          <div className="relative max-w-xl">
            <label htmlFor={`${id}-search`} className="text-sm font-semibold text-navy-900">Find a person or organization</label>
            <div className="relative mt-1.5">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                ref={searchRef}
                id={`${id}-search`}
                type="search"
                value={term}
                onChange={(event) => changeTerm(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') changeTerm('') }}
                placeholder="Name or profile address, at least 2 letters"
                autoComplete="off"
                aria-controls={`${id}-results`}
                aria-describedby={`${id}-search-status`}
                className={`${adminInputClass} pl-9`}
              />
            </div>
            <p id={`${id}-search-status`} role="status" className="mt-1 text-xs text-muted">
              {searchError ?? (showResults ? (searching ? 'Searching…' : `${results.length} match${results.length === 1 ? '' : 'es'}`) : '')}
            </p>
            {showResults && results.length ? (
              <ul id={`${id}-results`} aria-label="Search results" className="mt-1 max-h-72 overflow-auto rounded-lg border border-mist-200 bg-white shadow-lg">
                {results.map((result) => (
                  <li key={result.key}>
                    <button
                      type="button"
                      onClick={() => choose(result)}
                      className="flex w-full cursor-pointer items-center gap-2.5 px-3 py-2.5 text-left text-sm transition hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none"
                    >
                      <KindIcon kind={result.kind} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-semibold text-navy-950">{result.name}</span>
                        <span className="block truncate text-xs text-muted">{result.kind === 'organization' ? 'Organization' : 'Member'}{result.detail ? ` · ${result.detail}` : ''}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : (
          <form onSubmit={(event) => { void save(event) }} onKeyDown={(event) => { if (event.key === 'Escape') clearSelection() }} noValidate className="max-w-xl space-y-3 rounded-lg border border-mist-200 p-4">
            <div className="flex items-center gap-2">
              <KindIcon kind={selected.kind} />
              <p className="min-w-0 flex-1 truncate font-semibold text-navy-950">{selected.name}</p>
              <button type="button" onClick={clearSelection} aria-label="Choose someone else" className={iconButtonClass}>
                <X aria-hidden="true" className="size-4" />
              </button>
            </div>
            <div className="grid gap-3 sm:grid-cols-[9rem_minmax(0,1fr)]">
              <div className="grid content-start gap-1.5">
                <label htmlFor={`${id}-percent`} className="text-sm font-semibold text-navy-900">Their fee</label>
                <div className="flex items-center gap-2">
                  <input ref={percentRef} id={`${id}-percent`} name="percent" inputMode="decimal" autoComplete="off" placeholder={defaultPercentLabel.replace('%', '')} aria-invalid={Boolean(fieldErrors.percent)} aria-describedby={fieldErrors.percent ? `${id}-percent-error` : undefined} className={adminInputClass} />
                  <span aria-hidden="true" className="text-sm font-semibold text-muted">%</span>
                </div>
                {fieldErrors.percent ? <p id={`${id}-percent-error`} className="text-xs font-medium text-red-700">{fieldErrors.percent}</p> : null}
              </div>
              <div className="grid content-start gap-1.5">
                <label htmlFor={`${id}-note`} className="text-sm font-semibold text-navy-900">Note for admins <span className="font-normal text-muted">(optional)</span></label>
                <input id={`${id}-note`} name="note" maxLength={500} autoComplete="off" placeholder="e.g. Launch partner rate until March" aria-invalid={Boolean(fieldErrors.note)} className={adminInputClass} />
                {fieldErrors.note ? <p className="text-xs font-medium text-red-700">{fieldErrors.note}</p> : null}
              </div>
            </div>
            <p className="text-xs leading-5 text-muted">Replaces any rate they already have. Applies to new sales only.</p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" disabled={pending} aria-busy={pending || undefined} className={primaryButtonClass}>{pending ? 'Saving…' : 'Save rate'}</button>
              <button type="button" onClick={clearSelection} disabled={pending} className={secondaryButtonClass}>Cancel</button>
            </div>
          </form>
        )}
        {message ? (
          <p role={message.ok ? 'status' : 'alert'} className={`max-w-xl rounded-lg border px-3 py-2 text-sm font-medium ${message.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-red-200 bg-red-50 text-red-800'}`}>
            {message.text}
          </p>
        ) : null}
      </div>

      {overrides.length ? (
        <ul aria-label="Sellers with their own fee" className="divide-y divide-mist-100">
          {overrides.map((override) => (
            <li key={override.key} className="grid gap-2 px-5 py-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 font-semibold text-navy-950">
                  <KindIcon kind={override.kind} />
                  <span className="truncate">{override.name}</span>
                  <span className="shrink-0 rounded-md bg-ocean-50 px-1.5 text-xs font-bold text-ocean-800">{override.percentLabel}</span>
                </p>
                <p className="mt-0.5 break-words text-xs text-muted">{override.note ? `${override.note} · ` : ''}{override.updatedLabel}</p>
              </div>
              <RemoveOverrideButton override={override} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-6 text-sm text-muted">Everyone pays the default fee of {defaultPercentLabel}. Search above to give someone their own rate.</p>
      )}
    </div>
  )
}

function requestAnimationFrameSafe(callback: () => void) {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(callback)
  else setTimeout(callback, 0)
}
