'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { Check, RefreshCcw, Search } from 'lucide-react'
import { useEffect, useId, useState, useTransition, type RefObject } from 'react'
import { searchShareRecipients, sendPostToConnection, type ShareRecipient } from '../share-actions'
import { FeedDialog } from './feed-dialog'
import type { FeedNotice } from './share-utils'

const NOTE_MAX = 1000

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; recipients: ShareRecipient[]; totalConnections: number }
  | { status: 'error'; error: string }

/**
 * "Send" flow: pick one accepted connection, optionally add a note, and deliver the post
 * link as a direct message through the existing messaging system.
 */
export function SendPostDialog({
  postId,
  authorName,
  onClose,
  onNotice,
  returnFocusRef,
}: {
  postId: string
  authorName: string
  onClose(): void
  onNotice?(notice: FeedNotice): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const searchId = useId()
  const noteId = useId()
  const [query, setQuery] = useState('')
  const [loadState, setLoadState] = useState<LoadState>({ status: 'loading' })
  const [selected, setSelected] = useState<ShareRecipient | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [sent, setSent] = useState<{ recipient: ShareRecipient; conversationId: string } | null>(null)
  const [pending, startTransition] = useTransition()
  const [reloadToken, setReloadToken] = useState(0)

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      void searchShareRecipients(query).then((result) => {
        if (cancelled) return
        setLoadState(result.ok
          ? { status: 'ready', recipients: result.recipients, totalConnections: result.totalConnections }
          : { status: 'error', error: result.error })
      }).catch(() => {
        if (!cancelled) setLoadState({ status: 'error', error: 'We could not load your connections. Check your internet connection and try again.' })
      })
    }, query ? 200 : 0)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [query, reloadToken])

  function send() {
    if (!selected || pending) return
    setError('')
    const recipient = selected
    startTransition(async () => {
      const result = await sendPostToConnection({ postId, recipientProfileId: recipient.id, note })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSent({ recipient, conversationId: result.conversationId })
      onNotice?.({
        text: `Sent to ${recipient.fullName}.`,
        tone: 'success',
        href: `/messages/${result.conversationId}`,
        hrefLabel: 'Open conversation',
      })
    })
  }

  if (sent) {
    return (
      <FeedDialog title="Post sent" onClose={onClose} closeLabel="Close send dialog" returnFocusRef={returnFocusRef} initialFocusSelector="[data-autofocus]">
        <div role="status" className="flex items-start gap-3 rounded-2xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <p>{authorName}&apos;s post was sent to <span className="font-semibold">{sent.recipient.fullName}</span> as a message.</p>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Link href={`/messages/${sent.conversationId}`} className="inline-flex min-h-10 items-center rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
            Open conversation
          </Link>
          <button type="button" data-autofocus onClick={onClose} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900">
            Done
          </button>
        </div>
      </FeedDialog>
    )
  }

  const recipients = loadState.status === 'ready' ? loadState.recipients : []
  const noConnections = loadState.status === 'ready' && loadState.totalConnections === 0

  return (
    <FeedDialog
      title="Send in a message"
      description="Choose a connection. They will receive a link to this post in your conversation."
      onClose={onClose}
      closeLabel="Close send dialog"
      returnFocusRef={returnFocusRef}
      initialFocusSelector="input[type=search]"
    >
      {noConnections ? (
        <div className="rounded-2xl bg-mist-50 px-4 py-4 text-sm leading-6 text-muted">
          <p>You can send posts to your accepted connections. You don&apos;t have any connections yet.</p>
          <Link href="/network" className="mt-2 inline-flex font-semibold text-ocean-700 hover:text-ocean-800">Find people to connect with</Link>
        </div>
      ) : (
        <>
          <label htmlFor={searchId} className="block text-sm font-semibold text-navy-950">Search your connections</label>
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
              placeholder="Name, rank or company"
              autoComplete="off"
              className="min-h-11 w-full rounded-xl border border-mist-100 bg-white pl-9 pr-3 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
            />
          </div>

          <div className="mt-3 max-h-64 overflow-y-auto rounded-2xl border border-mist-100" aria-busy={loadState.status === 'loading'}>
            {loadState.status === 'loading' ? <p className="px-4 py-6 text-center text-sm text-muted">Loading your connections…</p> : null}
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
            {loadState.status === 'ready' && !recipients.length ? (
              <p className="px-4 py-6 text-center text-sm text-muted">No connections match “{query.trim()}”. Try a different name.</p>
            ) : null}
            {recipients.length ? (
              // min-w-0: a fieldset is min-content wide by default, which pushed long company names out of the list.
              <fieldset className="min-w-0">
                <legend className="sr-only">Choose a recipient</legend>
                <ul className="divide-y divide-mist-100">
                  {recipients.map((recipient) => {
                    const checked = selected?.id === recipient.id
                    return (
                      <li key={recipient.id}>
                        <label className={`flex min-h-14 cursor-pointer items-center gap-3 px-3 py-2 transition focus-within:bg-ocean-50 ${checked ? 'bg-ocean-50' : 'hover:bg-mist-50'}`}>
                          <input
                            type="radio"
                            name={`send-recipient-${postId}`}
                            value={recipient.id}
                            checked={checked}
                            onChange={() => { setSelected(recipient); setError('') }}
                            className="size-4 shrink-0 accent-ocean-700"
                          />
                          <span className="relative grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-mist-100 text-xs font-semibold text-navy-950">
                            {recipient.avatarUrl ? (
                              <MediaImage avatar src={recipient.avatarUrl} alt="" fill sizes="40px" className="object-cover" fallback={initials(recipient.fullName)} />
                            ) : initials(recipient.fullName)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-navy-950">{recipient.fullName}</span>
                            <span className="block truncate text-xs text-muted">{recipient.detail}</span>
                          </span>
                        </label>
                      </li>
                    )
                  })}
                </ul>
              </fieldset>
            ) : null}
          </div>

          <label htmlFor={noteId} className="mt-4 block text-sm font-semibold text-navy-950">
            Add a note <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={noteId}
            value={note}
            maxLength={NOTE_MAX}
            rows={2}
            onChange={(event) => setNote(event.target.value)}
            placeholder={selected ? `Say something to ${selected.fullName}…` : 'Say why this post is worth reading…'}
            className="mt-1.5 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
          />

          {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            <button type="button" onClick={onClose} disabled={pending} className="min-h-10 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-60">
              Cancel
            </button>
            <button
              type="button"
              onClick={send}
              disabled={!selected || pending}
              className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:opacity-50"
            >
              {pending ? 'Sending…' : selected ? `Send to ${selected.fullName.split(/\s+/)[0]}` : 'Send'}
            </button>
          </div>
        </>
      )}
    </FeedDialog>
  )
}
