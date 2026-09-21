'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  ArrowLeft,
  ExternalLink,
  MessageCircleMore,
  Minus,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useMessagingRealtime } from '@/features/realtime/provider'
import { markConversationReadAction } from '../actions'
import type { MessagingInboxItem, MessagingMessageDto } from '../queries'
import {
  subscribeMessagingUnreadCount,
} from '../unread-client'
import { MessageComposer, type OptimisticMessagingMessage } from './message-composer'

type DockMessage = MessagingMessageDto | OptimisticMessagingMessage

const HIDDEN_PATTERNS = [
  /^\/messages(?:\/|$)/,
  /^\/profile\/edit(?:\/|$)/,
  /^\/learn\/courses\/[^/]+\/learn(?:\/|$)/,
  /^\/learn\/studio(?:\/|$)/,
  /^\/hiring\/jobs\/new(?:\/|$)/,
  /^\/hiring\/jobs\/[^/]+\/edit(?:\/|$)/,
  /^\/events\/(?:new|create)(?:\/|$)/,
  /^\/events\/[^/]+\/edit(?:\/|$)/,
  /^\/admin(?:\/|$)/,
]

export function isMessagingDockHiddenPath(pathname: string) {
  return HIDDEN_PATTERNS.some((pattern) => pattern.test(pathname))
}

function initials(name: string | null) {
  if (!name) return 'SN'
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('')
}

function clock(value: string) {
  return new Date(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  })
}

function avatar(
  item: Pick<MessagingInboxItem, 'otherAvatarUrl' | 'otherName'>,
  testId?: string,
  sizeClass = 'size-9',
) {
  if (item.otherAvatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- signed profile media URL
      <img
        data-testid={testId}
        src={item.otherAvatarUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-full object-cover ring-1 ring-mist-100`}
      />
    )
  }

  return (
    <span
      data-testid={testId}
      className={`grid ${sizeClass} shrink-0 place-items-center rounded-full bg-mist-50 text-[10px] font-bold text-navy-950 ring-1 ring-mist-100`}
    >
      {initials(item.otherName)}
    </span>
  )
}

async function loadInbox() {
  const response = await fetch('/api/realtime/messaging-state', {
    method: 'GET',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('messaging_state_refresh_failed')
  const payload = await response.json() as {
    inbox?: unknown
    unreadCount?: unknown
  }
  if (!Array.isArray(payload.inbox) || typeof payload.unreadCount !== 'number') {
    throw new Error('messaging_invalid_state_response')
  }
  return {
    inbox: payload.inbox as MessagingInboxItem[],
    unreadCount: payload.unreadCount,
  }
}

async function loadThread(conversationId: string) {
  const response = await fetch(`/api/messages/${conversationId}`, {
    method: 'GET',
    cache: 'no-store',
  })
  if (!response.ok) throw new Error('messaging_thread_refresh_failed')
  const payload = await response.json() as {
    messages?: unknown
  }
  if (!Array.isArray(payload.messages)) throw new Error('messaging_invalid_thread_response')
  return payload.messages as MessagingMessageDto[]
}

export function MessagingDock({
  viewerId,
  initialUnreadCount,
}: {
  viewerId: string
  initialUnreadCount: number
}) {
  const pathname = usePathname()
  const { subscribe } = useMessagingRealtime()
  const [open, setOpen] = useState(false)
  const [inbox, setInbox] = useState<MessagingInboxItem[]>([])
  const [active, setActive] = useState<MessagingInboxItem | null>(null)
  const [messages, setMessages] = useState<DockMessage[]>([])
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount)
  const [loading, setLoading] = useState(false)
  const [otherTyping, setOtherTyping] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const hidden = isMessagingDockHiddenPath(pathname)

  useEffect(() => subscribeMessagingUnreadCount(setUnreadCount), [])

  useEffect(() => {
    if (!open || hidden) return
    let cancelled = false
    setLoading(true)
    void loadInbox()
      .then((state) => {
        if (cancelled) return
        setInbox(state.inbox)
        setUnreadCount(state.unreadCount)
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hidden, open])

  useEffect(() => {
    if (!active) return

    const unsubscribe = subscribe((signal) => {
      if (signal.eventType === 'conversation.typing') {
        if (
          signal.payload.conversationId !== active.conversationId
          || signal.payload.actorId !== active.otherProfileId
          || signal.payload.targetProfileId !== viewerId
        ) return

        if (typingTimerRef.current) clearTimeout(typingTimerRef.current)
        setOtherTyping(signal.payload.isTyping)
        if (signal.payload.isTyping) {
          typingTimerRef.current = setTimeout(() => {
            typingTimerRef.current = null
            setOtherTyping(false)
          }, 3000)
        }
        return
      }

      if (
        (signal.eventType === 'message.created' || signal.eventType === 'message.updated')
        && signal.payload.conversationId === active.conversationId
      ) {
        void loadThread(active.conversationId)
          .then((next) => setMessages(next))
          .catch(() => undefined)
      }
    })

    return () => {
      unsubscribe()
      if (typingTimerRef.current) {
        clearTimeout(typingTimerRef.current)
        typingTimerRef.current = null
      }
    }
  }, [active, subscribe, viewerId])

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({ block: 'end', behavior: 'auto' })
  }, [messages.length, otherTyping])

  const title = active?.otherName ?? 'Messaging'

  async function openConversation(item: MessagingInboxItem) {
    setActive(item)
    setMessages([])
    setOtherTyping(false)
    setLoading(true)
    try {
      const next = await loadThread(item.conversationId)
      setMessages(next)
      const latestReceived = [...next]
        .reverse()
        .find((message) => message.senderProfileId !== viewerId && !message.deletedAt)
      if (latestReceived) {
        void markConversationReadAction(item.conversationId, latestReceived.id)
      }
    } catch {
      setMessages([])
    } finally {
      setLoading(false)
    }
  }

  function addOptimistic(message: OptimisticMessagingMessage) {
    setMessages((current) => [
      ...current.filter((item) => item.clientMessageId !== message.clientMessageId),
      message,
    ])
  }

  function confirmMessage(clientMessageId: string, canonical: MessagingMessageDto) {
    setMessages((current) => current.map((message) => (
      message.clientMessageId === clientMessageId ? canonical : message
    )))
  }

  function failMessage(clientMessageId: string, error: string) {
    setMessages((current) => current.map((message) => (
      message.clientMessageId === clientMessageId && 'deliveryState' in message
        ? { ...message, deliveryState: 'failed' as const, error }
        : message
    )))
  }

  const activeMessages = useMemo(
    () => [...messages].sort((a, b) => (
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    )),
    [messages],
  )

  if (hidden) return null

  return (
    <div className="fixed bottom-0 right-6 z-[90] hidden md:block">
      {open ? (
        <section
          aria-label="Messaging dock"
          className="flex h-[min(36rem,calc(100vh-7rem))] w-[23rem] flex-col overflow-hidden rounded-t-2xl border border-b-0 border-mist-100 bg-white shadow-2xl"
        >
          <header className="flex min-h-14 items-center gap-2 border-b border-mist-100 px-3">
            {active ? (
              <button
                type="button"
                aria-label="Back to conversations"
                onClick={() => {
                  setActive(null)
                  setMessages([])
                  setOtherTyping(false)
                }}
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-950"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
              </button>
            ) : (
              <MessageCircleMore aria-hidden="true" className="size-5 text-ocean-700" />
            )}

            {active ? avatar(active, 'dock-peer-avatar', 'size-8') : null}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-navy-950">{title}</p>
              {active?.otherHeadline ? (
                <p className="truncate text-[11px] text-muted">{active.otherHeadline}</p>
              ) : null}
            </div>

            {active ? (
              <Link
                href={`/messages/${active.conversationId}`}
                aria-label="Open full conversation"
                className="grid size-8 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-ocean-700"
              >
                <ExternalLink aria-hidden="true" className="size-4" />
              </Link>
            ) : null}
            <button
              type="button"
              aria-label="Minimize messaging dock"
              onClick={() => setOpen(false)}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-950"
            >
              <Minus aria-hidden="true" className="size-4" />
            </button>
            <button
              type="button"
              aria-label="Close messaging dock"
              onClick={() => {
                setOpen(false)
                setActive(null)
              }}
              className="grid size-8 place-items-center rounded-lg text-muted hover:bg-mist-50 hover:text-navy-950"
            >
              <X aria-hidden="true" className="size-4" />
            </button>
          </header>

          {active ? (
            <>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto bg-mist-50/60 px-3 py-3">
                {loading && !activeMessages.length ? (
                  <div className="grid h-full place-items-center text-xs text-muted">Loading conversation…</div>
                ) : (
                  <div className="space-y-2">
                    {activeMessages.map((message) => {
                      const mine = message.senderProfileId === viewerId
                      return (
                        <div
                          key={`${message.clientMessageId}:${message.id}`}
                          className={`flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}
                        >
                          {!mine ? avatar(active, undefined, 'size-6') : null}
                          <div className={`max-w-[78%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                            <div className={`rounded-2xl px-3 py-2 text-xs leading-5 shadow-sm ${
                              mine
                                ? 'rounded-br-md bg-navy-900 text-white'
                                : 'rounded-bl-md border border-mist-100 bg-white text-navy-950'
                            }`}>
                              {message.attachment?.kind === 'image' && message.attachment.url ? (
                                // eslint-disable-next-line @next/next/no-img-element -- signed S3 message media URL
                                <img
                                  src={message.attachment.url}
                                  alt={message.attachment.name}
                                  className="mb-1.5 max-h-44 rounded-xl object-cover"
                                />
                              ) : message.attachment ? (
                                <p className="mb-1 text-[11px] font-semibold">
                                  📎 {message.attachment.name}
                                </p>
                              ) : null}
                              {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                            </div>
                            <span className="mt-0.5 px-1 text-[9px] text-muted">
                              {clock(message.createdAt)}{message.editedAt ? ' · Edited' : ''}
                            </span>
                          </div>
                        </div>
                      )
                    })}

                    {otherTyping ? (
                      <div className="flex items-end gap-1.5">
                        {avatar(active, undefined, 'size-6')}
                        <div
                          aria-label={`${active.otherName ?? 'Sea N Shore member'} is typing`}
                          className="flex h-8 items-center gap-1 rounded-2xl rounded-bl-md border border-mist-100 bg-white px-3 shadow-sm"
                        >
                          <span className="size-1.5 animate-pulse rounded-full bg-muted" />
                          <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:120ms]" />
                          <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:240ms]" />
                        </div>
                      </div>
                    ) : null}
                    <div ref={bottomRef} aria-hidden="true" className="h-px" />
                  </div>
                )}
              </div>

              <MessageComposer
                key={active.conversationId}
                conversationId={active.conversationId}
                viewerId={viewerId}
                typingTargetProfileId={active.otherProfileId}
                onOptimisticMessage={addOptimistic}
                onMessageConfirmed={confirmMessage}
                onMessageFailed={failMessage}
              />
            </>
          ) : (
            <div className="min-h-0 flex-1 overflow-y-auto">
              {loading && !inbox.length ? (
                <div className="grid h-full place-items-center text-xs text-muted">Loading messages…</div>
              ) : inbox.length ? (
                <div className="p-2">
                  {inbox.map((item) => {
                    const name = item.otherName ?? 'Sea N Shore member'
                    return (
                      <button
                        key={item.conversationId}
                        type="button"
                        aria-label={`Open compact chat with ${name}`}
                        onClick={() => void openConversation(item)}
                        className="flex w-full items-start gap-2.5 rounded-xl p-2.5 text-left transition hover:bg-mist-50"
                      >
                        {avatar(item)}
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <span className={`truncate text-xs ${item.unread ? 'font-bold' : 'font-semibold'} text-navy-950`}>
                              {name}
                            </span>
                            {item.unread ? <span className="size-2 shrink-0 rounded-full bg-ocean-600" /> : null}
                          </span>
                          <span className="mt-0.5 block truncate text-[11px] text-muted">
                            {item.lastMessageBody ?? item.otherHeadline ?? 'Start the conversation'}
                          </span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              ) : (
                <div className="grid h-full place-items-center px-6 text-center">
                  <div>
                    <p className="text-sm font-semibold text-navy-950">No conversations yet</p>
                    <Link href="/messages" className="mt-2 inline-block text-xs font-semibold text-ocean-700 hover:underline">
                      Open Messages
                    </Link>
                  </div>
                </div>
              )}
            </div>
          )}
        </section>
      ) : (
        <button
          type="button"
          aria-label="Open messaging dock"
          onClick={() => setOpen(true)}
          className="flex min-h-12 min-w-48 items-center gap-2 rounded-t-2xl border border-b-0 border-mist-100 bg-white px-4 text-sm font-bold text-navy-950 shadow-xl transition hover:bg-mist-50"
        >
          <MessageCircleMore aria-hidden="true" className="size-5 text-ocean-700" />
          <span className="flex-1 text-left">Messaging</span>
          {unreadCount > 0 ? (
            <span className="grid min-w-6 place-items-center rounded-full bg-ocean-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          ) : null}
        </button>
      )}
    </div>
  )
}
