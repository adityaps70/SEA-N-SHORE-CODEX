'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { BadgeCheck, ExternalLink, Search, X } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
import { cn } from '@/lib/cn'
import {
  createOrganizationHref,
  ORGANIZATION_SEARCH_MIN_LENGTH,
  type OrganizationSearchResult,
} from '../organization-link'
import { OrganizationLogo } from './organization-logo'

export type PickerOrganization = {
  id: string
  name: string
  logoUrl?: string | null
  verified?: boolean
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
 * that organization's page on Sea N Shore (its id goes in a hidden field); typing
 * a name that is not listed still saves it as plain text.
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
  const inputRef = useRef<HTMLInputElement | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const close = useCallback(() => {
    setOpen(false)
    setActiveIndex(-1)
  }, [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef: inputRef })

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

  function onChange(value: string) {
    setText(value)
    if (linked && !sameName(value, linked.name)) setLinked(null)
    setOpen(true)
    scheduleSearch(value)
  }

  function select(organization: OrganizationSearchResult) {
    setText(organization.name)
    setLinked({
      id: organization.id,
      name: organization.name,
      logoUrl: organization.logoUrl,
      verified: organization.verified,
    })
    close()
    inputRef.current?.focus()
  }

  function unlink() {
    setLinked(null)
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
  const showPanel = open && term.length >= ORGANIZATION_SEARCH_MIN_LENGTH && !linked
  const exactMatch = results.some((organization) => sameName(organization.name, term))
  const showCreate = status === 'ready' && !exactMatch && sameName(searchedFor, term)
  const activeOptionId = activeIndex >= 0 && results[activeIndex] ? `${baseId}-option-${results[activeIndex].id}` : undefined
  const helpText = error ?? hint ?? 'Start typing to find its page on Sea N Shore. Not listed? Keep the name as you typed it.'

  return (
    <div className={cn('min-w-0', labelClassName)}>
      <label htmlFor={inputId}>{label}</label>
      <div ref={rootRef} className="relative">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 mt-0.5 size-4 -translate-y-1/2 text-muted" />
          <input
            ref={inputRef}
            id={inputId}
            name={name}
            value={text}
            onChange={(event) => onChange(event.target.value)}
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

        {showPanel ? (
          <div className="absolute inset-x-0 top-full z-30 mt-1 overflow-hidden rounded-xl border border-mist-100 bg-white text-left font-normal shadow-[var(--shadow-card)]">
            {status === 'loading' ? (
              <p role="status" className="px-3 py-2.5 text-sm text-muted">Searching organizations…</p>
            ) : null}
            {status === 'error' && message ? (
              <p role="alert" className="px-3 py-2.5 text-sm text-red-700">{message}</p>
            ) : null}
            <ul id={listboxId} role="listbox" aria-label={`Organizations matching ${term}`} className={results.length ? 'max-h-72 overflow-y-auto py-1' : 'sr-only'}>
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
                      active ? 'bg-ocean-50' : 'hover:bg-mist-50',
                    )}
                  >
                    <OrganizationLogo logoUrl={organization.logoUrl} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1 text-sm font-semibold text-navy-950">
                        <span className="truncate">{organization.name}</span>
                        {organization.verified ? <BadgeCheck aria-label="Verified organization" className="size-3.5 shrink-0 text-ocean-700" /> : null}
                      </span>
                      {meta ? <span className="block truncate text-xs text-muted">{meta}</span> : null}
                    </span>
                  </li>
                )
              })}
            </ul>
            {showCreate ? (
              <div className={cn('bg-mist-50/60 px-3 py-2.5 text-sm', results.length ? 'border-t border-mist-100' : null)}>
                <p className="text-navy-950">
                  Can&apos;t find {term}?{' '}
                  <a
                    href={createOrganizationHref(term)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-ocean-700 hover:underline"
                  >
                    Create its page
                    <ExternalLink aria-hidden="true" className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </p>
                <p className="mt-1 text-xs leading-5 text-muted">
                  Sea N Shore reviews new organization pages before they go live. You can still save the name as you typed it.
                </p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {linked ? (
        <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 font-normal">
          <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-ocean-50 px-2 py-1 text-xs text-ocean-800">
            <OrganizationLogo logoUrl={linked.logoUrl} size="xs" />
            <span className="min-w-0 truncate">Linked to the {linked.name} page on Sea N Shore</span>
          </span>
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
      <p id={descriptionId} className={cn('mt-1 text-xs font-normal', error ? 'font-medium text-red-700' : 'text-muted')}>
        {helpText}
      </p>
    </div>
  )
}
