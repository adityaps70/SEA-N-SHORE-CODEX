'use client'

import Link from 'next/link'
import { ArrowLeft, Check, Clock3, RefreshCcw } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { markConversationReadAction } from '../actions'
import type { MessagingMessageDto } from '../queries'
import type { OptimisticMessagingMessage } from './message-composer'

export type MessageThreadItem = MessagingMessageDto | OptimisticMessagingMessage

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
  return new Date(value).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function dayKey(value: string) {
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

function deliveryState(message: MessageThreadItem) {
  return 'deliveryState' in message ? message.deliveryState : null
}

export function MessageThread({
  viewerId,
  conversationId,
  otherName,
  otherHeadline,
  otherAvatarUrl,
  messages,
  nextCursor,
}: {
  viewerId: string
  conversationId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  messages: MessageThreadItem[]
  nextCursor: { createdAt: string; id: string } | null
}) {
  const name = otherName ?? 'Sea N Shore member'
  const latestReceived = useMemo(
    () => [...messages].reverse().find((message) => message.senderProfileId !== viewerId && !message.deletedAt),
    [messages, viewerId],
  )

  useEffect(() => {
    if (!latestReceived) return
    void markConversationReadAction(conversationId, latestReceived.id)
  }, [conversationId, latestReceived?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,white,var(--mist-50))]">
      <header className="flex min-h-18 items-center gap-3 border-b border-mist-100 bg-white px-4 py-3 sm:px-5">
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="grid size-10 shrink-0 place-items-center rounded-xl text-navy-900 hover:bg-mist-50 md:hidden"
        >
          <ArrowLeft aria-hidden="true" className="size-4.5" />
        </Link>
        {otherAvatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- signed profile media URL
          <img src={otherAvatarUrl} alt="" className="size-11 rounded-2xl object-cover ring-1 ring-mist-100" />
        ) : (
          <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-xs font-bold text-navy-950 ring-1 ring-mist-100">
            {initials(otherName)}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-navy-950 sm:text-lg">{name}</h2>
          <p className="truncate text-xs text-muted sm:text-sm">{otherHeadline ?? 'Maritime professional'}</p>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-5 sm:px-6">
        {nextCursor ? (
          <div className="mb-5 flex justify-center">
            <span className="rounded-full border border-mist-100 bg-white px-3 py-1.5 text-xs font-semibold text-muted">
              Earlier messages are available
            </span>
          </div>
        ) : null}

        {messages.length ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
            {messages.map((message, index) => {
              const mine = message.senderProfileId === viewerId
              const state = deliveryState(message)
              const previous = messages[index - 1]
              const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
              return (
                <div key={`${message.clientMessageId}:${message.id}`}>
                  {showDay ? (
                    <div className="my-4 flex items-center gap-3" aria-label={`Messages from ${dayKey(message.createdAt)}`}>
                      <span className="h-px flex-1 bg-mist-100" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{dayKey(message.createdAt)}</span>
                      <span className="h-px flex-1 bg-mist-100" />
                    </div>
                  ) : null}
                  <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] sm:max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${mine ? 'rounded-br-md bg-navy-900 text-white' : 'rounded-bl-md border border-mist-100 bg-white text-navy-950'}`}>
                        <p className="whitespace-pre-wrap break-words">{message.body}</p>
                      </div>
                      <div className={`mt-1 flex items-center gap-1.5 px-1 text-[10px] ${state === 'failed' ? 'text-red-600' : 'text-muted'}`}>
                        <span>{clock(message.createdAt)}</span>
                        {mine && state === 'sending' ? <><Clock3 aria-hidden="true" className="size-3" /><span>Sending</span></> : null}
                        {mine && state === 'failed' ? <><RefreshCcw aria-hidden="true" className="size-3" /><span>Not sent</span></> : null}
                        {mine && !state ? <Check aria-label="Sent" className="size-3" /> : null}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="grid min-h-[22rem] place-items-center text-center">
            <div className="max-w-sm px-5">
              <div className="mx-auto grid size-14 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
                <span className="text-lg font-bold">Hi</span>
              </div>
              <h3 className="mt-4 text-lg font-bold text-navy-950">Start the conversation</h3>
              <p className="mt-2 text-sm leading-6 text-muted">Send a professional message to {name}. Keep the conversation relevant, respectful and maritime-focused.</p>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
