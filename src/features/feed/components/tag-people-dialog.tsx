'use client'

import { MediaImage } from '@/components/ui/media-image'
import { RefreshCcw, Search, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type RefObject } from 'react'
import { searchPhotoTagCandidates, type PhotoTagCandidate } from '../photo-tag-actions'
import { initials } from './author-avatar'
import { FeedDialog } from './feed-dialog'

/** A member chosen for a photo: what the composer keeps per photo and shows under the tile. */
export type TaggedPerson = { profileId: string; fullName: string }

export const PHOTO_TAG_LIMIT = 20

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; candidates: PhotoTagCandidate[] }
  | { status: 'error'; error: string }

/**
 * "Tag people" picker for one photo in the post composer (round 9B): search members
 * (connections first), tick as many as allowed, and confirm with Done.
 */
export function TagPeopleDialog({
  photoLabel,
  initialSelected,
  max = PHOTO_TAG_LIMIT,
  onDone,
  onClose,
  returnFocusRef,
}: {
  /** e.g. "photo 2", used in the dialog description. */
  photoLabel: string
  initialSelected: TaggedPerson[]
  max?: number
  onDone(selected: TaggedPerson[]): void
  onClose(): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<TaggedPerson[]>(initialSelected)
  const [reloadToken, setReloadToken] = useState(0)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchPhotoTagCandidates(query).then((result) => {
        if (cancelled) return
        setLoadState(result.ok ? { status: 'ready', candidates: result.candidates } : { status: 'error', error: result.error })
      }).catch(() => {
        if (!cancelled) setLoadState({ status: 'error', error: 'We could not load people to tag. Check your internet connection and try again.' })
      })
    }, query ? 200 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, reloadToken])

  // Escape closes only this picker: the composer behind it also listens for Escape on the
  // document and steps aside when the event was already handled.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      event.stopImmediatePropagation()
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const selectedIds = new Set(selected.map((person) => person.profileId))
  const atLimit = selected.length >= max

  function toggle(candidate: PhotoTagCandidate) {
    setSelected((current) => {
      if (current.some((person) => person.profileId === candidate.id)) {
        return current.filter((person) => person.profileId !== candidate.id)
      }
      if (current.length >= max) return current
      return [...current, { profileId: candidate.id, fullName: candidate.fullName }]
    })
  }

  function remove(profileId: string) {
    setSelected((current) => current.filter((person) => person.profileId !== profileId))
  }

  const candidates = loadState.status === 'ready' ? loadState.candidates : []
  const connections = candidates.filter((candidate) => candidate.connected)
  const others = candidates.filter((candidate) => !candidate.connected)

  function renderRow(candidate: PhotoTagCandidate) {
    const checked = selectedIds.has(candidate.id)
    const disabled = !checked && atLimit
    return (
      <li key={candidate.id}>
        <label className={`flex min-h-14 items-center gap-3 px-3 py-2 transition focus-within:bg-ocean-50 ${checked ? 'bg-ocean-50' : 'hover:bg-mist-50'} ${disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
          <input
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={() => toggle(candidate)}
            aria-label={`Tag ${candidate.fullName}`}
            className="size-4 shrink-0 accent-ocean-700"
          />
          <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
            {candidate.avatarUrl ? (
              <MediaImage avatar src={candidate.avatarUrl} alt="" fill sizes="40px" className="object-cover" fallback={initials(candidate.fullName)} />
            ) : initials(candidate.fullName)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-navy-950">{candidate.fullName}</span>
            <span className="block truncate text-xs text-muted">{candidate.detail}</span>
          </span>
        </label>
      </li>
    )
  }

  return (
    <FeedDialog
      title="Tag people"
      description={`Choose who is in ${photoLabel}. They will be notified when you post.`}
      onClose={onClose}
      closeLabel="Close tag people dialog"
      returnFocusRef={returnFocusRef}
      initialFocusSelector="input[type=search]"
    >
      <label htmlFor={searchId} className="block text-sm font-semibold text-navy-950">Search people</label>
      <div className="relative mt-1.5">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          id={searchId}
          type="search"
          value={query}
          maxLength={80}
          onChange={(event) => {
            setQuery(event.target.value)
            setLoadState({ status: 'loading' })
          }}
          // The picker may sit inside the composer form: Enter must not publish the post.
          onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }}
          placeholder="Name, rank or company"
          autoComplete="off"
          className="min-h-11 w-full rounded-xl border border-mist-100 bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
        />
      </div>

      {selected.length ? (
        <ul aria-label="Tagged people" className="mt-3 flex flex-wrap gap-1.5">
          {selected.map((person) => (
            <li key={person.profileId} className="inline-flex max-w-full items-center gap-1 rounded-full bg-ocean-50 py-1 pl-3 pr-1 text-sm font-semibold text-ocean-800">
              <span className="truncate">{person.fullName}</span>
              <button
                type="button"
                aria-label={`Remove ${person.fullName}`}
                onClick={() => remove(person.profileId)}
                className="grid size-6 shrink-0 place-items-center rounded-full text-ocean-700 hover:bg-ocean-100 hover:text-navy-950"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-2 text-xs text-muted" aria-live="polite">
        {atLimit ? `You can tag up to ${max} people in a photo.` : `${selected.length} of ${max} selected`}
      </p>

      <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-mist-100" aria-busy={loadState.status === 'loading'}>
        {loadState.status === 'loading' ? <p className="px-4 py-6 text-center text-sm text-muted">Loading people…</p> : null}
        {loadState.status === 'error' ? (
          <div className="m-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">
            <p role="alert">{loadState.error}</p>
            <button
              type="button"
              onClick={() => {
                setLoadState({ status: 'loading' })
                setReloadToken((token) => token + 1)
              }}
              className="mt-2 inline-flex min-h-9 items-center gap-2 rounded-lg bg-white px-3 text-xs font-semibold text-navy-950 ring-1 ring-red-100 hover:bg-red-50"
            >
              <RefreshCcw aria-hidden="true" className="size-3.5" /> Try again
            </button>
          </div>
        ) : null}
        {loadState.status === 'ready' && !candidates.length ? (
          <p className="px-4 py-6 text-center text-sm text-muted">
            {query.trim() ? `No members match “${query.trim()}”. Try a different name.` : 'No members to show yet. Search by name.'}
          </p>
        ) : null}
        {connections.length ? (
          <section aria-label="Your connections">
            <h3 className="bg-mist-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Your connections</h3>
            <ul className="divide-y divide-mist-100">{connections.map(renderRow)}</ul>
          </section>
        ) : null}
        {others.length ? (
          <section aria-label="Other members">
            <h3 className="bg-mist-50 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Other members</h3>
            <ul className="divide-y divide-mist-100">{others.map(renderRow)}</ul>
          </section>
        ) : null}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="min-h-10 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
          Cancel
        </button>
        <button
          type="button"
          onClick={() => onDone(selected)}
          className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900"
        >
          Done
        </button>
      </div>
    </FeedDialog>
  )
}
