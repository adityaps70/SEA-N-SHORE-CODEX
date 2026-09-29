'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { LoaderCircle, MessageCircleMore, RefreshCcw, Search, X } from 'lucide-react'
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from 'react'
import { createPortal } from 'react-dom'
import { startDirectConversationAction } from '../actions'
import type { MessageRecipient, MessageRecipientSearchResult } from '../recipients'
import { useModalLayer } from './use-modal-layer'

export type NewMessageSelection = {
  conversationId: string
  recipient: MessageRecipient
}

type NewMessageDialogProps = {
  open: boolean
  onClose: () => void
  /** Called once the conversation exists (reused or newly created). */
  onConversationReady: (selection: NewMessageSelection) => void
  /** Shown while the caller opens the conversation (for example during navigation). */
  openingConversation?: boolean
  debounceMs?: number
}

type SearchStatus = 'loading' | 'ready' | 'error'

const subscribeNothing = () => () => {}

function recipientInitials(name: string) {
  return (
    <span className="grid size-10 shrink-0 place-items-center rounded-full bg-mist-50 text-xs font-bold text-navy-950 ring-1 ring-mist-100">
      {initials(name)}
    </span>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SN'
}

async function fetchRecipients(query: string, signal: AbortSignal): Promise<MessageRecipientSearchResult> {
  const response = await fetch(`/api/messages/recipients?q=${encodeURIComponent(query)}`, {
    method: 'GET',
    cache: 'no-store',
    signal,
  })
  if (response.status === 401) throw new Error('Your session has ended. Sign in again to search your connections.')
  if (!response.ok) throw new Error('We could not load your connections. Check your connection and try again.')
  const payload = await response.json() as Partial<MessageRecipientSearchResult>
  if (!Array.isArray(payload.recipients) || typeof payload.connectionCount !== 'number') {
    throw new Error('We could not load your connections. Check your connection and try again.')
  }
  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    recipients: payload.recipients,
    connectionCount: payload.connectionCount,
  }
}

/**
 * Recipient picker used by the messages page and the chat dock. Search is
 * debounced and only returns people the server allows the viewer to message;
 * the viewer is never listed, an existing conversation is reused, and a new
 * one is created only after the server re-checks the connection.
 */
export function NewMessageDialog(props: NewMessageDialogProps) {
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false)
  if (!props.open || !isClient) return null
  return createPortal(<NewMessageDialogPanel {...props} />, document.body)
}

function NewMessageDialogPanel({
  onClose,
  onConversationReady,
  openingConversation = false,
  debounceMs = 250,
}: NewMessageDialogProps) {
  const titleId = useId()
  const listId = useId()
  const descriptionId = useId()
  const dialogRef = useModalLayer<HTMLDivElement>({ onClose })
  const [query, setQuery] = useState('')
  const [reloadToken, setReloadToken] = useState(0)
  const [status, setStatus] = useState<SearchStatus>('loading')
  const [result, setResult] = useState<MessageRecipientSearchResult | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [startingProfileId, setStartingProfileId] = useState<string | null>(null)
  const [selectionError, setSelectionError] = useState('')
  const [notice, setNotice] = useState('')
  const firstLoadRef = useRef(true)

  useEffect(() => {
    const controller = new AbortController()
    const delay = firstLoadRef.current ? 0 : debounceMs
    firstLoadRef.current = false
    const timer = setTimeout(() => {
      setStatus('loading')
      fetchRecipients(query.trim(), controller.signal)
        .then((next) => {
          if (controller.signal.aborted) return
          setResult(next)
          setStatus('ready')
          setActiveIndex(0)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setErrorMessage(error instanceof Error && error.message
            ? error.message
            : 'We could not load your connections. Check your connection and try again.')
          setStatus('error')
        })
    }, delay)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [debounceMs, query, reloadToken])

  const recipients = status === 'error' ? [] : result?.recipients ?? []
  const busy = Boolean(startingProfileId) || openingConversation
  const activeRecipient = recipients[activeIndex] ?? null

  const select = useCallback(async (recipient: MessageRecipient) => {
    if (busy) return
    setSelectionError('')
    if (recipient.status !== 'available') {
      setNotice(`${recipient.name}: ${recipient.unavailableReason ?? 'You cannot message this member yet.'}`)
      return
    }
    setNotice('')

    if (recipient.conversationId) {
      onConversationReady({ conversationId: recipient.conversationId, recipient })
      return
    }

    setStartingProfileId(recipient.profileId)
    try {
      const result = await startDirectConversationAction(recipient.profileId)
      if (!result.ok) {
        setSelectionError(result.error)
        return
      }
      onConversationReady({ conversationId: result.conversationId, recipient })
    } catch {
      setSelectionError('We could not open this conversation. Check your connection and try again.')
    } finally {
      setStartingProfileId(null)
    }
  }, [busy, onConversationReady])

  function onInputKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!recipients.length) return
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => (current + 1) % recipients.length)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => (current - 1 + recipients.length) % recipients.length)
    } else if (event.key === 'Home') {
      event.preventDefault()
      setActiveIndex(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      setActiveIndex(recipients.length - 1)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (activeRecipient) void select(activeRecipient)
    }
  }

  useEffect(() => {
    if (!activeRecipient) return
    document.getElementById(`${listId}-${activeRecipient.profileId}`)?.scrollIntoView?.({ block: 'nearest' })
  }, [activeRecipient, listId])

  const trimmedQuery = query.trim()
  const statusMessage = status === 'loading'
    ? 'Searching your connections…'
    : status === 'error'
      ? ''
      : recipients.length
        ? `${recipients.length} ${recipients.length === 1 ? 'person' : 'people'} found. Use the arrow keys to choose, then press Enter.`
        : trimmedQuery
          ? `No connections match “${trimmedQuery}”.`
          : 'You have no accepted connections yet.'

  return (
    <div
      className="fixed inset-0 z-[190] flex items-end justify-center bg-navy-950/40 sm:items-start sm:p-6 sm:pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className="flex max-h-[min(36rem,calc(100dvh-1rem))] w-full max-w-md flex-col overflow-hidden rounded-t-3xl border border-mist-100 bg-white shadow-2xl outline-none sm:rounded-3xl"
      >
        <div className="flex items-start gap-3 border-b border-mist-100 px-4 pb-3 pt-4 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-base font-bold text-navy-950">New message</h2>
            <p id={descriptionId} className="mt-0.5 text-xs leading-5 text-muted">Choose a connection. You can message accepted maritime connections.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close new message"
            className="cursor-pointer grid size-9 shrink-0 place-items-center rounded-full text-muted transition hover:bg-mist-50 hover:text-navy-950 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>

        <div className="px-4 pt-3 sm:px-5">
          <label htmlFor={`${listId}-input`} className="sr-only">Search your connections</label>
          <div className="flex min-h-11 items-center gap-2 rounded-xl border border-mist-100 bg-mist-50 px-3 focus-within:border-ocean-500 focus-within:bg-white">
            <Search aria-hidden="true" className="size-4 shrink-0 text-muted" />
            <input
              data-autofocus
              id={`${listId}-input`}
              type="search"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={recipients.length > 0}
              aria-controls={listId}
              aria-activedescendant={activeRecipient ? `${listId}-${activeRecipient.profileId}` : undefined}
              autoComplete="off"
              spellCheck={false}
              maxLength={80}
              value={query}
              readOnly={busy}
              aria-busy={status === 'loading'}
              placeholder="Search by name, rank or company"
              onChange={(event) => {
                setQuery(event.target.value)
                setNotice('')
                setSelectionError('')
              }}
              onKeyDown={onInputKeyDown}
              className="min-w-0 flex-1 bg-transparent py-2 text-sm text-navy-950 outline-none placeholder:text-muted read-only:opacity-60"
            />
            {status === 'loading' ? (
              <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-ocean-700" />
            ) : null}
          </div>
          <p role="status" aria-live="polite" className="sr-only">{statusMessage}</p>
        </div>

        {selectionError ? (
          <p role="alert" className="mx-4 mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium leading-5 text-red-700 sm:mx-5">
            {selectionError}
          </p>
        ) : null}
        {notice ? (
          <p role="alert" className="mx-4 mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-900 sm:mx-5">
            {notice}
          </p>
        ) : null}
        {openingConversation ? (
          <p className="mx-4 mt-3 flex items-center gap-2 text-xs font-semibold text-ocean-700 sm:mx-5">
            <LoaderCircle aria-hidden="true" className="size-4 animate-spin" /> Opening conversation…
          </p>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3 pt-2 sm:px-3">
          {status === 'error' ? (
            <div role="alert" className="m-2 rounded-2xl bg-red-50 p-4 text-sm text-red-800">
              <p className="font-semibold">Connections did not load</p>
              <p className="mt-1 text-xs leading-5">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setReloadToken((token) => token + 1)}
                className="cursor-pointer mt-3 inline-flex min-h-9 items-center gap-2 rounded-xl bg-white px-3 text-xs font-semibold text-navy-950 ring-1 ring-red-100 hover:bg-red-50"
              >
                <RefreshCcw aria-hidden="true" className="size-3.5" /> Try again
              </button>
            </div>
          ) : !result ? (
            <ul aria-hidden="true" className="space-y-1 p-1">
              {[0, 1, 2].map((item) => (
                <li key={item} className="flex items-center gap-3 rounded-xl p-2">
                  <span className="size-10 animate-pulse rounded-full bg-mist-100" />
                  <span className="flex-1 space-y-1.5">
                    <span className="block h-3 w-1/2 animate-pulse rounded bg-mist-100" />
                    <span className="block h-2.5 w-3/4 animate-pulse rounded bg-mist-50" />
                  </span>
                </li>
              ))}
            </ul>
          ) : recipients.length ? (
            <ul id={listId} role="listbox" aria-label="Connections you can message" className="space-y-0.5">
              {recipients.map((recipient, index) => {
                const available = recipient.status === 'available'
                const active = index === activeIndex
                const starting = startingProfileId === recipient.profileId
                return (
                  <li
                    key={recipient.profileId}
                    id={`${listId}-${recipient.profileId}`}
                    role="option"
                    aria-selected={active}
                    aria-disabled={!available || busy}
                    onMouseMove={() => setActiveIndex(index)}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void select(recipient)}
                    className={`flex cursor-pointer items-center gap-3 rounded-xl p-2 transition ${
                      active ? 'bg-ocean-50 ring-1 ring-ocean-100' : 'hover:bg-mist-50'
                    } ${available ? '' : 'cursor-not-allowed opacity-75'}`}
                  >
                    {recipient.avatarUrl ? (
                      <MediaImage src={recipient.avatarUrl} alt="" width={40} height={40} sizes="40px" className="size-10 shrink-0 rounded-full object-cover ring-1 ring-mist-100" fallback={recipientInitials(recipient.name)} />
                    ) : recipientInitials(recipient.name)}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-navy-950">{recipient.name}</span>
                      <span className="block truncate text-xs text-muted">
                        {available
                          ? recipient.subtitle ?? `@${recipient.slug}`
                          : recipient.unavailableReason}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] font-semibold text-ocean-700">
                      {starting
                        ? <LoaderCircle aria-label="Opening conversation" className="size-4 animate-spin" />
                        : available
                          ? recipient.conversationId ? 'Open chat' : 'Message'
                          : <span className="text-muted">Not yet</span>}
                    </span>
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="m-2 rounded-2xl bg-mist-50 p-4 text-center">
              <MessageCircleMore aria-hidden="true" className="mx-auto size-6 text-ocean-700" />
              {status === 'loading' ? (
                <p className="mt-2 text-sm font-semibold text-navy-950">Searching your connections…</p>
              ) : trimmedQuery && result.connectionCount > 0 ? (
                <>
                  <p className="mt-2 text-sm font-semibold text-navy-950">No connections match “{trimmedQuery}”</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Check the spelling, or search by rank or company. You can only message people you are connected with.</p>
                </>
              ) : (
                <>
                  <p className="mt-2 text-sm font-semibold text-navy-950">No connections to message yet</p>
                  <p className="mt-1 text-xs leading-5 text-muted">Connect with maritime professionals in My Network. Once they accept, you can message them here.</p>
                  <Link
                    href="/network"
                    onClick={onClose}
                    className="mt-3 inline-flex min-h-9 items-center rounded-xl bg-navy-950 px-4 text-xs font-semibold text-white hover:bg-navy-900"
                  >
                    Find people in My Network
                  </Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
