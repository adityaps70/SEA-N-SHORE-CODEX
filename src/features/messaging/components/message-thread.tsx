'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  Download,
  Ellipsis,
  FileText,
  RefreshCcw,
  Reply,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  deleteMessageAction,
  markConversationReadAction,
  setMessageReactionAction,
} from '../actions'
import { publishMessagingUnreadCount } from '../unread-client'
import type { MessagingMessageDto } from '../queries'
import { isMessageSeen, type MessagingReadCursor } from '../thread-realtime'
import type { OptimisticMessagingMessage } from './message-composer'
import { MessageEmojiPicker } from './message-emoji-picker'

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

function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`
  const mb = kb / 1024
  return `${mb.toFixed(mb >= 100 ? 0 : 1)} MB`
}

function groupedReactions(message: MessageThreadItem, viewerId: string) {
  const groups = new Map<string, { count: number; viewerReacted: boolean }>()
  for (const reaction of message.reactions ?? []) {
    const current = groups.get(reaction.emoji) ?? { count: 0, viewerReacted: false }
    current.count += 1
    if (reaction.profileId === viewerId) current.viewerReacted = true
    groups.set(reaction.emoji, current)
  }
  return [...groups.entries()].map(([emoji, value]) => ({ emoji, ...value }))
}

function AttachmentCard({ message, mine }: { message: MessageThreadItem; mine: boolean }) {
  const attachment = message.attachment
  if (!attachment) return null

  if (attachment.kind === 'image') {
    return attachment.url ? (
      <a href={attachment.url} target="_blank" rel="noreferrer" className="mb-2 block overflow-hidden rounded-xl">
        {/* eslint-disable-next-line @next/next/no-img-element -- signed S3 attachment URL */}
        <img
          src={attachment.url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-[26rem] w-full min-w-48 object-cover"
        />
      </a>
    ) : (
      <div className="mb-2 flex min-w-48 items-center gap-2 rounded-xl bg-black/10 px-3 py-3 text-xs">
        <FileText aria-hidden="true" className="size-4" />
        {attachment.name}
      </div>
    )
  }

  if (attachment.kind === 'video') {
    return attachment.url ? (
      <video
        src={attachment.url}
        controls
        preload="metadata"
        aria-label={attachment.name}
        className="mb-2 max-h-[24rem] min-w-56 max-w-full rounded-xl bg-black"
      />
    ) : (
      <div className="mb-2 rounded-xl bg-black/10 px-3 py-3 text-xs">{attachment.name}</div>
    )
  }

  return (
    <a
      href={attachment.url || undefined}
      target="_blank"
      rel="noreferrer"
      download={attachment.name}
      className={`mb-2 flex min-w-56 items-center gap-3 rounded-xl border px-3 py-3 transition ${
        mine
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-mist-100 bg-mist-50 hover:bg-mist-100'
      }`}
    >
      <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${mine ? 'bg-white/10' : 'bg-white'}`}>
        <FileText aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold">{attachment.name}</span>
        <span className={`mt-0.5 block text-[10px] ${mine ? 'text-white/70' : 'text-muted'}`}>
          {fileSize(attachment.size)}
        </span>
      </span>
      <Download aria-hidden="true" className="size-4 shrink-0" />
    </a>
  )
}

function ReplyPreview({ message, mine }: { message: MessageThreadItem; mine: boolean }) {
  const reply = message.replyTo
  if (!reply) return null

  return (
    <div className={`mb-2 rounded-xl border-l-3 px-3 py-2 text-xs ${
      mine
        ? 'border-white/70 bg-white/10 text-white/80'
        : 'border-ocean-500 bg-ocean-50 text-navy-900'
    }`}>
      <p className="text-[10px] font-bold uppercase tracking-[0.08em] opacity-70">Reply</p>
      <p className="mt-0.5 line-clamp-2">
        {reply.deleted
          ? 'Original message unavailable'
          : reply.body || reply.attachmentName || 'Attachment'}
      </p>
    </div>
  )
}

export function MessageThread({
  viewerId,
  conversationId,
  otherName,
  otherHeadline,
  otherAvatarUrl,
  messages,
  nextCursor,
  peerReadCursor,
  onReply,
}: {
  viewerId: string
  conversationId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  messages: MessageThreadItem[]
  nextCursor: { createdAt: string; id: string } | null
  peerReadCursor: MessagingReadCursor | null
  onReply?: (message: MessagingMessageDto) => void
}) {
  const router = useRouter()
  const name = otherName ?? 'Sea N Shore member'
  const lastRequestedReadIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const [interactionError, setInteractionError] = useState('')
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null)
  const latestReceived = useMemo(
    () => [...messages].reverse().find((message) => message.senderProfileId !== viewerId && !message.deletedAt),
    [messages, viewerId],
  )

  const attemptMarkRead = useCallback(() => {
    if (!latestReceived) return
    if (document.visibilityState !== 'visible') return
    if (lastRequestedReadIdRef.current === latestReceived.id) return

    const requestedId = latestReceived.id
    lastRequestedReadIdRef.current = requestedId
    void markConversationReadAction(conversationId, requestedId)
      .then((result) => {
        if (result.ok) {
          publishMessagingUnreadCount(result.unreadCount)
          router.refresh()
          return
        }
        if (lastRequestedReadIdRef.current === requestedId) {
          lastRequestedReadIdRef.current = null
        }
      })
      .catch(() => {
        if (lastRequestedReadIdRef.current === requestedId) {
          lastRequestedReadIdRef.current = null
        }
      })
  }, [conversationId, latestReceived, router])

  const latestMessageKey = messages.length
    ? `${messages.at(-1)?.id ?? ''}:${messages.length}`
    : 'empty'

  useEffect(() => {
    bottomRef.current?.scrollIntoView?.({
      block: 'end',
      behavior: 'auto',
    })
  }, [conversationId, latestMessageKey])

  useEffect(() => {
    const onPotentialView = () => attemptMarkRead()
    document.addEventListener('visibilitychange', onPotentialView)
    attemptMarkRead()

    return () => {
      document.removeEventListener('visibilitychange', onPotentialView)
    }
  }, [attemptMarkRead])

  async function react(messageId: string, emoji: string | null) {
    if (pendingMessageId) return
    setPendingMessageId(messageId)
    setInteractionError('')
    try {
      const result = await setMessageReactionAction(messageId, emoji)
      if (!result.ok) {
        setInteractionError(result.error)
        return
      }
      router.refresh()
    } catch {
      setInteractionError('We could not update your reaction.')
    } finally {
      setPendingMessageId(null)
    }
  }

  async function unsend(messageId: string) {
    if (pendingMessageId) return
    setPendingMessageId(messageId)
    setInteractionError('')
    try {
      const result = await deleteMessageAction(messageId)
      if (!result.ok) {
        setInteractionError(result.error)
        return
      }
      router.refresh()
    } catch {
      setInteractionError('We could not unsend this message.')
    } finally {
      setPendingMessageId(null)
    }
  }

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

      <div data-testid="message-scroll-area" className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-5 sm:px-6">
        {nextCursor ? (
          <div className="mb-5 flex justify-center">
            <span className="rounded-full border border-mist-100 bg-white px-3 py-1.5 text-xs font-semibold text-muted">
              Earlier messages are available
            </span>
          </div>
        ) : null}

        {interactionError ? (
          <div role="alert" className="mx-auto mb-3 max-w-3xl rounded-xl bg-red-50 px-3 py-2 text-center text-xs font-medium text-red-700">
            {interactionError}
          </div>
        ) : null}

        {messages.length ? (
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-2.5">
            {messages.map((message, index) => {
              const mine = message.senderProfileId === viewerId
              const state = deliveryState(message)
              const canonicalStatus = mine && !state
                ? (isMessageSeen(message, peerReadCursor) ? 'Seen' : 'Sent')
                : null
              const previous = messages[index - 1]
              const showDay = !previous || dayKey(previous.createdAt) !== dayKey(message.createdAt)
              const reactionGroups = groupedReactions(message, viewerId)
              const myReaction = (message.reactions ?? []).find((reaction) => reaction.profileId === viewerId)?.emoji ?? null
              const canonicalForReply = !('deliveryState' in message) ? message : null

              return (
                <div key={`${message.clientMessageId}:${message.id}`}>
                  {showDay ? (
                    <div className="my-4 flex items-center gap-3" aria-label={`Messages from ${dayKey(message.createdAt)}`}>
                      <span className="h-px flex-1 bg-mist-100" />
                      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">{dayKey(message.createdAt)}</span>
                      <span className="h-px flex-1 bg-mist-100" />
                    </div>
                  ) : null}

                  <div className={`group flex items-end gap-1.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                    {!mine ? (
                      <div className="mb-5 flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        <MessageEmojiPicker
                          mode="reaction"
                          align="start"
                          currentEmoji={myReaction}
                          triggerLabel={`React to message ${message.id}`}
                          onSelect={(emoji) => void react(message.id, emoji)}
                        />
                        {canonicalForReply && onReply ? (
                          <button
                            type="button"
                            aria-label={`Reply to message ${message.id}`}
                            onClick={() => onReply(canonicalForReply)}
                            className="grid size-8 place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-ocean-700"
                          >
                            <Reply aria-hidden="true" className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    <div className={`max-w-[86%] sm:max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div className={`w-full rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm ${
                        mine
                          ? 'rounded-br-md bg-navy-900 text-white'
                          : 'rounded-bl-md border border-mist-100 bg-white text-navy-950'
                      }`}>
                        <ReplyPreview message={message} mine={mine} />
                        <AttachmentCard message={message} mine={mine} />
                        {message.body ? <p className="whitespace-pre-wrap break-words">{message.body}</p> : null}
                      </div>

                      {reactionGroups.length ? (
                        <div className={`-mt-1 flex flex-wrap gap-1 px-2 ${mine ? 'justify-end' : 'justify-start'}`}>
                          {reactionGroups.map((reaction) => (
                            <button
                              key={reaction.emoji}
                              type="button"
                              aria-label={`${reaction.emoji} ${reaction.count} ${reaction.count === 1 ? 'reaction' : 'reactions'}`}
                              disabled={pendingMessageId === message.id}
                              onClick={() => void react(message.id, reaction.viewerReacted ? null : reaction.emoji)}
                              className={`inline-flex min-h-8 min-w-10 items-center justify-center gap-1 rounded-xl bg-navy-950/90 px-2.5 py-1 text-base leading-none text-white shadow-sm backdrop-blur-sm transition hover:scale-105 hover:bg-navy-950 ${
                                reaction.viewerReacted ? 'opacity-100' : 'opacity-90'
                              }`}
                            >
                              <span>{reaction.emoji}</span>
                              {reaction.count > 1 ? <span className="text-[10px] font-semibold text-white/80">{reaction.count}</span> : null}
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className={`mt-1 flex items-center gap-1.5 px-1 text-[10px] ${state === 'failed' ? 'text-red-600' : 'text-muted'}`}>
                        <span>{clock(message.createdAt)}</span>
                        {mine && state === 'sending' ? <><Clock3 aria-hidden="true" className="size-3" /><span>Sending</span></> : null}
                        {mine && state === 'failed' ? <><RefreshCcw aria-hidden="true" className="size-3" /><span>Not sent</span></> : null}
                        {canonicalStatus === 'Sent' ? <><Check aria-hidden="true" className="size-3" /><span>Sent</span></> : null}
                        {canonicalStatus === 'Seen' ? <><CheckCheck aria-hidden="true" className="size-3" /><span>Seen</span></> : null}
                      </div>
                    </div>

                    {mine ? (
                      <div className="mb-5 flex items-center gap-1 opacity-100 transition sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        {canonicalForReply && onReply ? (
                          <button
                            type="button"
                            aria-label={`Reply to message ${message.id}`}
                            onClick={() => onReply(canonicalForReply)}
                            className="grid size-8 place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-ocean-700"
                          >
                            <Reply aria-hidden="true" className="size-4" />
                          </button>
                        ) : null}
                        <MessageEmojiPicker
                          mode="reaction"
                          align="end"
                          currentEmoji={myReaction}
                          triggerLabel={`React to message ${message.id}`}
                          onSelect={(emoji) => void react(message.id, emoji)}
                        />
                        {canonicalForReply ? (
                          <details className="relative">
                            <summary
                              role="button"
                              aria-label={`More actions for message ${message.id}`}
                              className="grid size-8 cursor-pointer list-none place-items-center rounded-full border border-mist-100 bg-white text-muted shadow-sm transition hover:text-navy-950"
                            >
                              <Ellipsis aria-hidden="true" className="size-4" />
                            </summary>
                            <div className="absolute bottom-full right-0 z-40 mb-2 min-w-44 rounded-xl border border-mist-100 bg-white p-1 shadow-xl">
                              <button
                                type="button"
                                disabled={pendingMessageId === message.id}
                                onClick={() => void unsend(message.id)}
                                className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                              >
                                <Trash2 aria-hidden="true" className="size-4" />
                                Unsend message
                              </button>
                            </div>
                          </details>
                        ) : null}
                      </div>
                    ) : null}
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
        <div ref={bottomRef} aria-hidden="true" className="h-px" />
      </div>
    </section>
  )
}
