'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { BadgeCheck, Briefcase, Building2, ChevronLeft, Clock3, Search, X } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import { cn } from '@/lib/cn'
import {
  ORGANIZATION_SEARCH_MIN_LENGTH,
  registerOrganizationHref,
  type LinkedOrganization,
  type OrganizationReturnPath,
  type OrganizationSearchResult,
} from '../organization-link'
import { OrganizationLogo } from './organization-logo'
import { OrganizationStatusBadge } from './organization-status-badge'
import { UnclaimedOrganizationForm } from './unclaimed-organization-form'

export type PickerOrganization = {
  id: string
  name: string
  logoUrl?: string | null
  verified?: boolean
  unclaimed?: boolean
  /** The member's own organization that Sea N Shore is still verifying. */
  pending?: boolean
}

type SearchStatus = 'idle' | 'loading' | 'ready' | 'error'

const SEARCH_DEBOUNCE_MS = 250
const SEARCH_ENDPOINT = '/api/profile/organization-search'

const defaultLabelClass = 'block text-sm font-semibold text-navy-950'
const defaultInputClass = 'mt-1 min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-ink outline-none focus:border-ocean-500'

function sameName(left: string, right: string) {
  return left.trim().toLocaleLowerCase('en') === right.trim().toLocaleLowerCase('en')
}

/**
 * Type-ahead for "current organization". Picking a result links the profile to
 * that organization's page on Sea N Shore (its id goes in a hidden field).
 * When the organization is not listed the member chooses:
 * - "I own or manage this organization": the registration flow, verified by
 *   Sea N Shore, prefilled with the name and returning to `returnTo`;
 * - "I just work there": a small inline form that adds an unclaimed page and
 *   links it straight away.
 * Typing a name without choosing still saves it as plain text.
 */
export function OrganizationPicker({
  label,
  name = 'currentCompany',
  idName = 'currentCompanyId',
  defaultName = '',
  defaultOrganization = null,
  error,
  hint,
  labelClassName = defaultLabelClass,
  inputClassName = defaultInputClass,
  returnTo,
  onBeforeRegister,
  phoneFullScreen = false,
}: {
  label: string
  name?: string
  idName?: string
  defaultName?: string
  defaultOrganization?: PickerOrganization | null
  error?: string
  hint?: string
  labelClassName?: string
  inputClassName?: string
  /** Page the registration flow returns to (it then links the new organization). */
  returnTo?: OrganizationReturnPath
  /** Called just before leaving for the registration flow, e.g. to keep a draft. */
  onBeforeRegister?: (link: HTMLAnchorElement) => void
  /**
   * Phones only (below md): while the field is focused the search opens full screen, with
   * the input at the top and the results under it, so the keyboard never covers them.
   */
  phoneFullScreen?: boolean
}) {
  const baseId = useId()
  const inputId = `${baseId}-input`
  const listboxId = `${baseId}-listbox`
  const descriptionId = `${baseId}-description`
  const [text, setText] = useState(defaultOrganization?.name ?? defaultName)
  const [linked, setLinked] = useState<PickerOrganization | null>(defaultOrganization)
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<SearchStatus>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [results, setResults] = useState<OrganizationSearchResult[]>([])
  const [searchedFor, setSearchedFor] = useState('')
  const [activeIndex, setActiveIndex] = useState(-1)
  const [adding, setAdding] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  /** Full-screen search on phones (only when `phoneFullScreen`). */
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
    setExpanded(false)
  }, [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open || expanded, close, { triggerRef: inputRef })
  /** Leave the phone full-screen search and put the keyboard away. */
  const finishPhoneSearch = useCallback(() => {
    close()
    inputRef.current?.blur()
  }, [close])

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    abortRef.current?.abort()
  }, [])

  function runSearch(term: string) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setStatus('loading')
    setMessage(null)

    fetch(`${SEARCH_ENDPOINT}?q=${encodeURIComponent(term)}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await response.json().catch(() => null) as
          | { organizations?: OrganizationSearchResult[]; error?: string }
          | null
        if (controller.signal.aborted) return
        if (!response.ok || !Array.isArray(body?.organizations)) {
          setStatus('error')
          setResults([])
          setMessage(body?.error ?? 'We could not search organizations right now. You can keep typing the name and save it as text.')
          return
        }
        setResults(body.organizations)
        setSearchedFor(term)
        setActiveIndex(-1)
        setStatus('ready')
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setStatus('error')
        setResults([])
        setMessage('We could not reach Sea N Shore to search organizations. Check your connection, or keep typing the name and save it as text.')
      })
  }

  function scheduleSearch(value: string) {
    if (timerRef.current) clearTimeout(timerRef.current)
    const term = value.trim()
    if (term.length < ORGANIZATION_SEARCH_MIN_LENGTH) {
      abortRef.current?.abort()
      setStatus('idle')
      setResults([])
      setMessage(null)
      return
    }
    timerRef.current = setTimeout(() => runSearch(term), SEARCH_DEBOUNCE_MS)
  }

  /** Tapping (or typing into) the field on a phone opens the full-screen search. */
  function expandPhoneSearch() {
    if (phoneFullScreen && !expanded && !adding) setExpanded(true)
  }

  function onChange(value: string) {
    expandPhoneSearch()
    setText(value)
    setNotice(null)
    if (linked && !sameName(value, linked.name)) setLinked(null)
    setOpen(true)
    scheduleSearch(value)
  }

  function select(organization: LinkedOrganization, options: { focus?: boolean } = {}) {
    setText(organization.name)
    setLinked({
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      verified: organization.verified,
      unclaimed: organization.unclaimed,
    })
    setAdding(false)
    close()
    if (options.focus !== false) inputRef.current?.focus()
  }

  function startAdding() {
    abortRef.current?.abort()
    if (timerRef.current) clearTimeout(timerRef.current)
    close()
    setNotice(null)
    setAdding(true)
  }

  function added(organization: LinkedOrganization) {
    select(organization)
    setNotice(`${organization.name} is now on Sea N Shore as an unclaimed page and linked here. It is saved with your profile.`)
  }

  function unlink() {
    setLinked(null)
    setNotice(null)
    inputRef.current?.focus()
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (!open) {
        setOpen(true)
        if (text.trim().length >= ORGANIZATION_SEARCH_MIN_LENGTH && status === 'idle') scheduleSearch(text)
        return
      }
      if (results.length) setActiveIndex((index) => (index + 1) % results.length)
      return
    }
    if (event.key === 'ArrowUp') {
      if (!open || !results.length) return
      event.preventDefault()
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1))
      return
    }
    if (event.key === 'Enter' && open && activeIndex >= 0 && results[activeIndex]) {
      event.preventDefault()
      select(results[activeIndex])
    }
  }

  const term = text.trim()
  const showPanel = open && !adding && term.length >= ORGANIZATION_SEARCH_MIN_LENGTH && !linked
  const exactMatch = results.some((organization) => sameName(organization.name, term))
  const showCreate = status === 'ready' && !exactMatch && sameName(searchedFor, term)
  const activeOptionId = activeIndex >= 0 && results[activeIndex] ? `${baseId}-option-${results[activeIndex].id}` : undefined
  const helpText = error ?? hint ?? 'Start typing to find its page on Sea N Shore. Not listed? Add it, or keep the name as you typed it.'
  const fullScreen = phoneFullScreen && expanded

  return (
    <div className={cn('min-w-0', labelClassName)}>
      <label htmlFor={inputId}>{label}</label>
      <div
        ref={rootRef}
        className={cn(
          'relative',
          fullScreen && 'max-md:fixed max-md:inset-0 max-md:z-50 max-md:flex max-md:flex-col max-md:overflow-y-auto max-md:bg-white max-md:px-4 max-md:pb-[env(safe-area-inset-bottom)] max-md:pt-[env(safe-area-inset-top)]',
        )}
        role={fullScreen ? 'group' : undefined}
        aria-label={fullScreen ? `Search ${label}` : undefined}
        data-phone-fullscreen={fullScreen ? 'true' : undefined}
      >
        {fullScreen ? (
          <div className="flex min-h-14 items-center gap-2 font-normal md:hidden">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={finishPhoneSearch}
              aria-label="Close organization search"
              className="-ml-2 grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
            >
              <ChevronLeft aria-hidden="true" className="size-6" />
            </button>
            <p className="min-w-0 flex-1 truncate text-[17px] font-bold text-navy-950">{label}</p>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={finishPhoneSearch}
              className="inline-flex min-h-11 cursor-pointer items-center rounded-full px-3 text-sm font-semibold text-ocean-700 hover:bg-ocean-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
            >
              Done
            </button>
          </div>
        ) : null}
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            id={inputId}
            name={name}
            value={text}
            onChange={(event) => onChange(event.target.value)}
            onPointerDown={expandPhoneSearch}
            onFocus={() => { if (!linked && term.length >= ORGANIZATION_SEARCH_MIN_LENGTH) setOpen(true) }}
            onKeyDown={onKeyDown}
            maxLength={160}
            autoComplete="off"
            role="combobox"
            aria-expanded={showPanel}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={showPanel ? activeOptionId : undefined}
            aria-invalid={Boolean(error)}
            aria-describedby={descriptionId}
            className={cn(inputClassName, 'pl-9', linked ? 'pr-10' : null)}
          />
          {linked ? (
            <BadgeCheck aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-ocean-700" />
          ) : null}
        </div>
        <input type="hidden" name={idName} value={linked?.id ?? ''} />
        {fullScreen && !showPanel ? (
          <p className="mt-3 text-sm font-normal leading-6 text-muted md:hidden">{helpText}</p>
        ) : null}

        {showPanel ? (
          <div
            className={cn(
              'absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-mist-100 bg-white text-left font-normal shadow-[var(--shadow-card)]',
              fullScreen && 'max-md:static max-md:mt-3 max-md:overflow-visible max-md:rounded-none max-md:border-0 max-md:shadow-none',
            )}
          >
            {status === 'loading' ? (
              <p role="status" className="px-3 py-2.5 text-sm text-muted">Searching organizations…</p>
            ) : null}
            {status === 'error' && message ? (
              <p role="alert" className="px-3 py-2.5 text-sm text-red-700">{message}</p>
            ) : null}
            <ul id={listboxId} role="listbox" aria-label={`Organizations matching ${term}`} className={results.length ? cn('max-h-72 overflow-y-auto py-1', fullScreen && 'max-md:max-h-none') : 'sr-only'}>
              {results.map((organization, index) => {
                const meta = [organization.type, organization.location].filter(Boolean).join(' · ')
                const active = index === activeIndex
                return (
                  <li
                    key={organization.id}
                    id={`${baseId}-option-${organization.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => select(organization)}
                    onMouseEnter={() => setActiveIndex(index)}
                    className={cn(
                      'flex cursor-pointer items-center gap-3 px-3 py-2',
                      fullScreen && 'max-md:min-h-14 max-md:border-b max-md:border-mist-100 max-md:px-1',
                      active ? 'bg-ocean-50' : 'hover:bg-mist-50',
                    )}
                  >
                    <OrganizationLogo logoUrl={organization.logoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm font-semibold text-navy-950">
                        <span className="truncate">{organization.name}</span>
                        <OrganizationStatusBadge organization={organization} size="sm" />
                      </span>
                      {meta ? <span className="block truncate text-xs text-muted">{meta}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
            {showCreate ? (
              <div role="group" aria-labelledby={`${baseId}-missing`} className={cn('bg-mist-50/60 px-3 py-3 text-sm', results.length ? 'border-t border-mist-100' : null)}>
                <p id={`${baseId}-missing`} className="font-semibold text-navy-950">Can&apos;t find {term}? Tell us how you are connected to it.</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <a
                    href={registerOrganizationHref(term, returnTo)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={(event) => onBeforeRegister?.(event.currentTarget)}
                    className="flex min-h-11 items-start gap-2.5 rounded-xl border border-mist-200 bg-white p-3 text-left transition hover:border-ocean-300 hover:bg-ocean-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
                  >
                    <Building2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-navy-950">I own or manage this organization</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted">Register it. Sea N Shore verifies it before it can publish, then you come back here.</span>
                    </span>
                  </a>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={startAdding}
                    className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border border-mist-200 bg-white p-3 text-left transition hover:border-ocean-300 hover:bg-ocean-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
                  >
                    <Briefcase aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
                    <span className="min-w-0">
                      <span className="block font-semibold text-navy-950">I just work there</span>
                      <span className="mt-0.5 block text-xs leading-5 text-muted">Add a basic, unclaimed page and link it now.</span>
                    </span>
                  </button>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted">Or keep typing and save the name as text.</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {adding ? (
        <UnclaimedOrganizationForm
          initialName={term}
          onAdded={added}
          onUseExisting={(organization) => select(organization)}
          onCancel={() => {
            setAdding(false)
            inputRef.current?.focus()
          }}
        />
      ) : null}

      {linked ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 font-normal">
          <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-ocean-50 px-2 py-1 text-xs text-ocean-800">
            <OrganizationLogo logoUrl={linked.logoUrl} size="xs" />
            <span className="min-w-0 truncate">Linked to the {linked.name} page on Sea N Shore</span>
          </span>
          {linked.pending ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
              <Clock3 aria-hidden="true" className="size-3" /> Waiting for Sea N Shore verification
            </span>
          ) : (
            <OrganizationStatusBadge organization={linked} size="sm" />
          )}
          <button
            type="button"
            onClick={unlink}
            className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-lg border border-mist-200 bg-white px-2.5 text-xs font-semibold text-navy-950 hover:border-ocean-500 hover:text-ocean-700"
          >
            <X aria-hidden="true" className="size-3.5" />
            Unlink
          </button>
        </div>
      ) : null}
      {notice ? <p role="status" className="mt-1 text-xs font-medium text-emerald-800">{notice}</p> : null}
      <p id={descriptionId} className={cn('mt-1 text-xs font-normal', error ? 'font-medium text-red-700' : 'text-muted')}>
        {helpText}
      </p>
    </div>
  )
}
