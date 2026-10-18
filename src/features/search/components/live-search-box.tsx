'use client'

import { BookOpen, BriefcaseBusiness, Building2, CalendarDays, Clock3, FileText, LoaderCircle, Search, UsersRound, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useMemo, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { clearRecentSearchesAction, getRecentSearchesAction, recordSearchAction } from '../search-actions'
import { viewerInitials } from '@/components/navigation/viewer-avatar'
import { createSearchClient, type SearchClientState, type SuggestItem } from '../search-client'
import { highlightParts } from '../highlight'

/**
 * Round G (G4): search as you type, an ARIA combobox (WAI-ARIA 1.2 list autocomplete).
 * - `dropdown` (top bar, desktop): results in a popup under the field.
 * - `fullscreen` (phone search screen): the same live results fill the screen under the field.
 * Empty field: the member's recent searches with Clear all. Up/Down move, Enter opens the active
 * result (or all results), Esc closes. Old results stay while new ones load; the count is announced.
 */
const KIND_ICON = { person: UsersRound, org: Building2, community: UsersRound, job: BriefcaseBusiness, course: BookOpen, event: CalendarDays, post: FileText } as const
const KIND_LABEL = { person: 'Person', org: 'Organization', community: 'Community', job: 'Job', course: 'Course', event: 'Event', post: 'Post' } as const

type Option =
  | { type: 'result'; item: SuggestItem }
  | { type: 'recent'; query: string }
  | { type: 'all'; query: string }

function Highlighted({ text, query }: { text: string; query: string }) {
  return <>{highlightParts(text, query).map((part, index) => (part.match ? <mark key={index} className="bg-transparent font-bold text-navy-950">{part.text}</mark> : <span key={index}>{part.text}</span>))}</>
}

export function LiveSearchBox({
  variant = 'dropdown',
  initialQuery = '',
  inputId,
  placeholder = 'Search Sea N Shore',
  autoFocus = false,
  className = '',
  inputClassName = '',
}: {
  variant?: 'dropdown' | 'fullscreen'
  initialQuery?: string
  inputId?: string
  placeholder?: string
  autoFocus?: boolean
  className?: string
  inputClassName?: string
}) {
  const router = useRouter()
  const generatedId = useId()
  const id = inputId ?? `live-search-${generatedId}`
  const listId = `${id}-results`
  const [text, setText] = useState(initialQuery)
  const [open, setOpen] = useState(variant === 'fullscreen')
  const [state, setState] = useState<SearchClientState>({ status: 'idle', query: '', response: null })
  const [recent, setRecent] = useState<string[] | null>(null)
  const [active, setActive] = useState(-1)
  const [, startTransition] = useTransition()
  const rootRef = useRef<HTMLDivElement>(null)
  const client = useMemo(() => (typeof window === 'undefined' ? null : createSearchClient({ onState: setState, debounceMs: 120 })), [])

  useEffect(() => () => client?.cancel(), [client])

  // Close the popup on an outside click (dropdown only).
  useEffect(() => {
    if (variant !== 'dropdown' || !open) return
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    return () => document.removeEventListener('pointerdown', onPointer)
  }, [open, variant])

  function loadRecent() {
    if (recent !== null) return
    startTransition(async () => setRecent(await getRecentSearchesAction()))
  }

  const query = text.trim()
  const items = query ? state.response?.items ?? [] : []
  const options: Option[] = query
    ? [...items.map((item): Option => ({ type: 'result', item })), { type: 'all', query }]
    : (recent ?? []).map((value): Option => ({ type: 'recent', query: value }))
  const loading = state.status === 'loading' && Boolean(query)
  const showList = open && (query ? true : (recent?.length ?? 0) > 0)
  const statusText = !query
    ? ''
    : loading && !state.response
      ? 'Searching…'
      : `${items.length} result${items.length === 1 ? '' : 's'}${state.response?.partial ? ', more may be available' : ''}. Press Enter for all results.`

  function change(value: string) {
    setText(value)
    setActive(-1)
    setOpen(true)
    if (!value.trim()) loadRecent()
    client?.type(value)
  }

  function seeAll(value: string) {
    void recordSearchAction(value, items.length)
    setOpen(variant === 'fullscreen')
    router.push(`/search?q=${encodeURIComponent(value)}`)
  }

  function choose(option: Option) {
    if (option.type === 'all') return seeAll(option.query)
    if (option.type === 'recent') {
      change(option.query)
      return
    }
    void recordSearchAction(query, items.length, option.item.kind)
    setOpen(variant === 'fullscreen')
    router.push(option.item.href)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setOpen(true)
      if (!query) loadRecent()
      setActive((current) => (options.length ? (current + 1) % options.length : -1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((current) => (options.length ? (current <= 0 ? options.length - 1 : current - 1) : -1))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      const option = active >= 0 ? options[active] : undefined
      if (option) choose(option)
      else if (query) seeAll(query)
    } else if (event.key === 'Escape') {
      if (open && variant === 'dropdown') {
        event.preventDefault()
        setOpen(false)
        setActive(-1)
      } else if (text) {
        event.preventDefault()
        change('')
      }
    }
  }

  const optionId = (index: number) => `${id}-option-${index}`
  const listClass = variant === 'dropdown'
    ? 'absolute left-0 right-0 top-full z-50 mt-1 max-h-[70vh] min-w-[22rem] overflow-y-auto rounded-xl border border-mist-200 bg-white py-1 shadow-lg'
    : 'mt-2 -mx-4 border-t border-mist-100 bg-white'

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <form
        role="search"
        action="/search"
        method="get"
        onSubmit={(event) => {
          event.preventDefault()
          if (query) seeAll(query)
        }}
        className="relative"
      >
        <label htmlFor={id} className="sr-only">Search Sea N Shore</label>
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          id={id}
          name="q"
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? optionId(active) : undefined}
          aria-describedby={`${id}-status`}
          autoComplete="off"
          enterKeyHint="search"
          maxLength={80}
          autoFocus={autoFocus}
          value={text}
          placeholder={placeholder}
          onChange={(event) => change(event.target.value)}
          onFocus={() => {
            setOpen(true)
            if (!query) loadRecent()
          }}
          onKeyDown={onKeyDown}
          className={inputClassName || 'min-h-10 w-full rounded-lg bg-mist-50 py-2 pl-9 pr-9 text-sm text-ink placeholder:text-muted'}
        />
        {loading ? <LoaderCircle aria-hidden="true" className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted" /> : null}
      </form>
      <p id={`${id}-status`} role="status" aria-live="polite" className="sr-only">{statusText}</p>
      {showList ? (
        <div className={listClass}>
          {!query && recent?.length ? (
            <div className="flex items-center justify-between px-4 pb-1 pt-2">
              <span className="text-xs font-bold uppercase tracking-wide text-muted">Recent searches</span>
              <button
                type="button"
                onClick={() => startTransition(async () => {
                  await clearRecentSearchesAction()
                  setRecent([])
                })}
                className="min-h-9 rounded-lg px-2 text-sm font-semibold text-ocean-700 hover:bg-mist-50"
              >
                Clear all
              </button>
            </div>
          ) : null}
          <ul id={listId} role="listbox" aria-label={query ? `Results for ${query}` : 'Recent searches'} className={loading && state.response ? 'opacity-70 transition-opacity' : ''}>
            {options.map((option, index) => {
              const selected = index === active
              const base = `flex min-h-12 cursor-pointer items-center gap-3 px-4 py-2 text-sm ${selected ? 'bg-mist-100' : 'hover:bg-mist-50'}`
              if (option.type === 'recent') {
                return (
                  <li key={`recent-${option.query}`} id={optionId(index)} role="option" aria-selected={selected} className={base} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
                    <Clock3 aria-hidden="true" className="size-4 shrink-0 text-muted" />
                    <span className="min-w-0 flex-1 truncate text-navy-950">{option.query}</span>
                  </li>
                )
              }
              if (option.type === 'all') {
                return (
                  <li key="all" id={optionId(index)} role="option" aria-selected={selected} className={`${base} border-t border-mist-100 font-semibold text-ocean-700`} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
                    <Search aria-hidden="true" className="size-4 shrink-0" />
                    <span className="min-w-0 flex-1 truncate">See all results for “{option.query}”</span>
                  </li>
                )
              }
              const { item } = option
              const Icon = KIND_ICON[item.kind]
              return (
                <li key={`${item.kind}-${item.id}`} id={optionId(index)} role="option" aria-selected={selected} className={base} onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)}>
                  {item.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- a 32 px signed thumbnail; the optimizer link is already sized
                    <img src={item.avatarUrl} alt="" width={32} height={32} className={`size-8 shrink-0 object-cover ${item.kind === 'person' ? 'rounded-full' : 'rounded-lg'}`} />
                  ) : item.kind === 'person' ? (
                    // Round H (H6): people without a photo show their initials, as everywhere else.
                    <span aria-hidden="true" data-testid="suggestion-initials" className="grid size-8 shrink-0 place-items-center rounded-full bg-mist-100 text-xs font-semibold text-navy-950">{viewerInitials(item.name)}</span>
                  ) : (
                    <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-lg bg-mist-50 text-ocean-700"><Icon className="size-4" /></span>
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-navy-950"><Highlighted text={item.name} query={query} /></span>
                    <span className="block truncate text-xs text-muted">{KIND_LABEL[item.kind]}{item.subtitle ? ` · ${item.subtitle}` : ''}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {query && !items.length && !loading ? <p className="px-4 pb-2 text-sm text-muted">No quick matches. Press Enter to search everything.</p> : null}
        </div>
      ) : null}
      {variant === 'fullscreen' && open && text ? (
        <button type="button" aria-label="Clear search" onClick={() => change('')} className="absolute right-1 top-0 grid size-11 place-items-center rounded-full text-muted hover:bg-mist-50">
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
    </div>
  )
}
