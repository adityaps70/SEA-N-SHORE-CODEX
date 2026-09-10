'use client'

import Link from 'next/link'
import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadReactionDetails } from '../actions'
import {
  POST_REACTIONS,
  POST_REACTION_META,
  reactionCount,
  type PostReactionType,
  type ReactionDetailsPage,
  type ReactionSummary,
  type ReactionTargetType,
} from '../types'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function OpenReactionDetails({
  targetType,
  targetId,
  summary,
  onClose,
}: {
  targetType: ReactionTargetType
  targetId: string
  summary: ReactionSummary
  onClose(): void
}) {
  const [reaction, setReaction] = useState<PostReactionType | null>(null)
  const [page, setPage] = useState<ReactionDetailsPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const total = reactionCount(summary)
  const active = POST_REACTIONS.filter((item) => summary[item] > 0)

  useEffect(() => {
    let cancelled = false
    const request = reaction
      ? { targetType, targetId, reaction, limit: 30 as const }
      : { targetType, targetId, limit: 30 as const }

    void loadReactionDetails(request).then((result) => {
      if (cancelled) return
      if (result.ok) setPage(result.page)
      else {
        setPage(null)
        setError(result.error)
      }
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setPage(null)
      setError('We could not load reactions.')
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [reaction, targetId, targetType])

  function selectReaction(next: PostReactionType | null) {
    if (reaction === next) return
    setReaction(next)
    setPage(null)
    setError('')
    setLoading(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/35 p-4" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        role="dialog"
        aria-modal="true"
        aria-label="Reactions"
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-mist-100 px-5 py-4">
          <h2 className="text-base font-semibold text-navy-950">Reactions</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reactions"
            className="inline-flex size-9 items-center justify-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950"
          >
            <X aria-hidden="true" className="size-5" />
          </button>
        </header>

        <div className="flex gap-1 overflow-x-auto border-b border-mist-100 px-4 pt-2" aria-label="Filter reactions">
          <button
            type="button"
            aria-pressed={reaction === null}
            onClick={() => selectReaction(null)}
            className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${reaction === null ? 'border-ocean-600 text-ocean-700' : 'border-transparent text-muted hover:text-navy-950'}`}
          >
            All {total}
          </button>
          {active.map((item) => (
            <button
              key={item}
              type="button"
              aria-pressed={reaction === item}
              onClick={() => selectReaction(item)}
              className={`rounded-t-lg border-b-2 px-3 py-2 text-sm font-semibold transition ${reaction === item ? 'border-ocean-600 text-ocean-700' : 'border-transparent text-muted hover:text-navy-950'}`}
            >
              <span aria-hidden="true">{POST_REACTION_META[item].emoji}</span>{' '}
              {POST_REACTION_META[item].label} {summary[item]}
            </button>
          ))}
        </div>

        <div className="max-h-[60vh] overflow-y-auto p-3">
          {loading ? <p className="px-3 py-8 text-center text-sm text-muted">Loading reactions…</p> : null}
          {!loading && error ? <p role="alert" className="m-2 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
          {!loading && !error && page?.reactors.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">No reactions to show.</p>
          ) : null}
          {!loading && !error && page?.reactors.length ? (
            <ul className="divide-y divide-mist-100">
              {page.reactors.map((reactor) => {
                const details = [reactor.rank ?? reactor.headline, reactor.currentCompany].filter(Boolean).join(' · ')
                return (
                  <li key={reactor.id} className="flex items-center gap-3 px-2 py-3">
                    <div className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                      {reactor.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={reactor.avatarUrl} alt="" className="h-full w-full object-cover" />
                      ) : initials(reactor.fullName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/people/${reactor.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
                        {reactor.fullName}
                      </Link>
                      {details ? <p className="mt-0.5 truncate text-sm text-muted">{details}</p> : null}
                    </div>
                    <span aria-label={POST_REACTION_META[reactor.reaction].label} className="shrink-0 text-lg">
                      {POST_REACTION_META[reactor.reaction].emoji}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : null}
        </div>
      </section>
    </div>
  )
}

export function ReactionDetailsModal({
  open,
  targetType,
  targetId,
  summary,
  onClose,
}: {
  open: boolean
  targetType: ReactionTargetType
  targetId: string
  summary: ReactionSummary
  onClose(): void
}) {
  if (!open) return null
  return <OpenReactionDetails targetType={targetType} targetId={targetId} summary={summary} onClose={onClose} />
}
