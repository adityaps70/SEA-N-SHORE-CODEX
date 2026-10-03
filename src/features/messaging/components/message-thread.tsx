'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  Copy,
  Download,
  Ellipsis,
  FileText,
  Pencil,
  RefreshCcw,
  Reply,
  Smile,
  Trash2,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { BottomSheet, SheetRow } from '@/components/ui/mobile-sheet'
import {
  deleteMessageAction,
  editMessageAction,
  markConversationReadAction,
  setMessageReactionAction,
} from '../actions'
import { isWithinMessageEditWindow } from '../edit-policy'
import { publishMessagingUnreadCount } from '../unread-client'
import type { MessagingMessageDto } from '../queries'
import { isMessageSeen, type MessagingReadCursor } from '../thread-realtime'
import { messageAttachmentRoute } from '../media-policy'
import {
  ConversationActionsMenu,
  messagingProfileHref,
  type DeletedConversationResult,
} from './conversation-actions'
import { ImageLightbox, type LightboxImage } from './image-lightbox'
import type { OptimisticMessagingMessage } from './message-composer'
import { MessageEmojiPicker, QUICK_REACTIONS } from './message-emoji-picker'
import { LinkifiedText } from './linkified-text'

export type MessageThreadItem = MessagingMessageDto | OptimisticMessagingMessage

/** Phones: press and hold a message this long to open its action sheet. */
export const MESSAGE_LONG_PRESS_MS = 450
const LONG_PRESS_MOVE_TOLERANCE_PX = 10
const PHONE_MEDIA_QUERY = '(max-width: 767.98px)'

function isPhoneViewport() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(PHONE_MEDIA_QUERY).matches
}

/** Photos in a thread, in order, for the in-app viewer (prev/next across the conversation). */
export function lightboxImagesFromMessages(messages: readonly MessageThreadItem[]): LightboxImage[] {
  return messages.flatMap((message) => {
    const attachment = message.attachment
    if (message.deletedAt || attachment?.kind !== 'image' || !attachment.url) return []
    const canonical = !('deliveryState' in message)
    return [{
      id: message.id,
      src: attachment.url,
      alt: attachment.name,
      name: attachment.name,
      downloadUrl: canonical ? messageAttachmentRoute(message.id, { download: true }) : null,
    }]
  })
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

function AttachmentCard({
  message,
  mine,
  onOpenImage,
}: {
  message: MessageThreadItem
  mine: boolean
  onOpenImage: (messageId: string) => void
}) {
  const attachment = message.attachment
  if (!attachment) return null

  if (attachment.kind === 'image') {
    return attachment.url ? (
      <button
        type="button"
        onClick={() => onOpenImage(message.id)}
        aria-label={`Open photo ${attachment.name}`}
        aria-haspopup="dialog"
        data-testid={`message-photo-${message.id}`}
        className="mb-2 block w-full cursor-zoom-in overflow-hidden rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- authorised attachment route or local preview */}
        <img
          src={attachment.url}
          alt={attachment.name}
          loading="lazy"
          className="max-h-[26rem] w-full min-w-48 object-cover"
        />
      </button>
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

  const canonical = !('deliveryState' in message)
  return (
    <a
      href={(canonical ? messageAttachmentRoute(message.id, { download: true }) : attachment.url) || undefined}
      download={attachment.name}
      className={`mb-2 flex min-w-56 items-center gap-3 rounded-xl border px-3 py-3 transition ${
        mine
          ? 'border-white/20 bg-white/10 hover:bg-white/15'
          : 'border-mist-200 bg-mist-50 hover:bg-mist-100'
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
  otherSlug = null,
  messages,
  nextCursor,
  peerReadCursor,
  onReply,
  otherTyping = false,
  onConversationDeleted,
  hideHeaderOnPhones = false,
}: {
  viewerId: string
  conversationId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  /** Profile handle of the other person; their photo and name link to /people/<slug>. */
  otherSlug?: string | null
  messages: MessageThreadItem[]
  nextCursor: { createdAt: string; id: string } | null
  peerReadCursor: MessagingReadCursor | null
  onReply?: (message: MessagingMessageDto) => void
  otherTyping?: boolean
  /** Called after "Delete conversation" succeeds. Without it the thread returns to /messages itself. */
  onConversationDeleted?: (result: DeletedConversationResult) => void
  /** The messages page shows its own phone page bar (back, peer, "…") instead of this header. */
  hideHeaderOnPhones?: boolean
}) {
  const router = useRouter()
  const name = otherName ?? 'Sea N Shore member'
  const profileHref = messagingProfileHref(otherSlug)
  const lastRequestedReadIdRef = useRef<string | null>(null)
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLElement | null>(null)
  const [interactionError, setInteractionError] = useState('')
  const [pendingMessageId, setPendingMessageId] = useState<string | null>(null)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editBody, setEditBody] = useState('')
  const [editWindowNow, setEditWindowNow] = useState(() => Date.now())
  const [lightboxImageId, setLightboxImageId] = useState<string | null>(null)
  const lightboxOpenRef = useRef(false)
  const lightboxImages = useMemo(() => lightboxImagesFromMessages(messages), [messages])
  const [sheetMessageId, setSheetMessageId] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout>; x: number; y: number } | null>(null)
  const longPressFiredRef = useRef(false)
  const closeSheet = useCallback(() => setSheetMessageId(null), [])
  const sheetMessage = sheetMessageId ? messages.find((message) => message.id === sheetMessageId) ?? null : null
  const closeLightbox = useCallback(() => setLightboxImageId(null), [])
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
    lightboxOpenRef.current = lightboxImageId !== null
  }, [lightboxImageId])

  useEffect(() => {
    // Keep the reader's place while a photo is open; the viewer returns them
    // to exactly where they were.
    if (lightboxOpenRef.current) return
    bottomRef.current?.scrollIntoView?.({
      block: 'end',
      behavior: 'auto',
    })
  }, [conversationId, latestMessageKey, otherTyping])

  useEffect(() => {
    const timer = window.setInterval(() => setEditWindowNow(Date.now()), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const closeMenus = (target?: EventTarget | null) => {
      const menus = threadRef.current?.querySelectorAll<HTMLDetailsElement>('details[data-dismissible-menu][open]') ?? []
      for (const menu of menus) {
        if (target && menu.contains(target as Node)) continue
        menu.open = false
      }
    }

    const onPointerDown = (event: PointerEvent) => closeMenus(event.target)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }

    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])


  useEffect(() => {
    const onPotentialView = () => attemptMarkRead()
    document.addEventListener('visibilitychange', onPotentialView)
    attemptMarkRead()

    return () => {
      document.removeEventListener('visibilitychange', onPotentialView)
    }
  }, [attemptMarkRead])

  function beginEdit(message: MessagingMessageDto) {
    setInteractionError('')
    setEditingMessageId(message.id)
    setEditBody(message.body)
  }

  function cancelEdit() {
    setEditingMessageId(null)
    setEditBody('')
  }

  async function saveEdit(messageId: string) {
    const body = editBody.trim()
    if (!body || pendingMessageId) return
    setPendingMessageId(messageId)
    setInteractionError('')
    try {
      const result = await editMessageAction(messageId, body)
      if (!result.ok) {
        setInteractionError(result.error)
        return
      }
      cancelEdit()
      router.refresh()
    } catch {
      setInteractionError('We could not edit this message.')
    } finally {
      setPendingMessageId(null)
    }
  }

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

  function openMessageSheet(messageId: string) {
    if (editingMessageId) return
    setInteractionError('')
    setSheetMessageId(messageId)
  }

  function clearLongPress() {
    if (longPressRef.current) clearTimeout(longPressRef.current.timer)
    longPressRef.current = null
  }

  /** Touch and pen only: a press-and-hold opens the phone action sheet; mouse keeps hover buttons. */
  function startLongPress(event: ReactPointerEvent<HTMLElement>, messageId: string) {
    if (event.pointerType === 'mouse') return
    clearLongPress()
    longPressFiredRef.current = false
    const { clientX: x, clientY: y } = event
    longPressRef.current = {
      x,
      y,
      timer: setTimeout(() => {
        longPressRef.current = null
        longPressFiredRef.current = true
        navigator.vibrate?.(10)
        openMessageSheet(messageId)
      }, MESSAGE_LONG_PRESS_MS),
    }
  }

  function moveLongPress(event: ReactPointerEvent<HTMLElement>) {
    const press = longPressRef.current
    if (!press) return
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > LONG_PRESS_MOVE_TOLERANCE_PX) clearLongPress()
  }

  /** Android fires contextmenu on long-press; on phones it opens the sheet instead of the browser menu. */
  function onBubbleContextMenu(event: ReactMouseEvent<HTMLElement>, messageId: string) {
    if (!isPhoneViewport()) return
    event.preventDefault()
    clearLongPress()
    longPressFiredRef.current = true
    openMessageSheet(messageId)
  }

  /** The tap that ends a long-press must not also open a photo or follow a link. */
  function onBubbleClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!longPressFiredRef.current) return
    longPressFiredRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  async function copyMessageText(message: MessageThreadItem) {
    if (!message.body || !navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(message.body)
      setCopiedMessageId(message.id)
      setTimeout(() => setCopiedMessageId((current) => (current === message.id ? null : current)), 1600)
    } catch {
      setInteractionError('We could not copy this message.')
    }
  }

  useEffect(() => () => clearLongPress(), [])

  const incomingInitials = (testId: string) => (
    <span
      data-testid={testId}
      className="grid size-7 place-items-center rounded-full bg-white text-[9px] font-bold text-navy-950 ring-1 ring-mist-100"
    >
      {initials(otherName)}
    </span>
  )
  const incomingAvatar = (messageId: string) => (otherAvatarUrl ? (
    <MediaImage
      avatar
      data-testid={`message-avatar-${messageId}`}
      src={otherAvatarUrl}
      alt=""
      width={28}
      height={28}
      sizes="28px"
      className="block size-7 rounded-full object-cover ring-1 ring-mist-100"
      fallback={incomingInitials(`message-avatar-${messageId}`)}
    />
  ) : incomingInitials(`message-avatar-${messageId}`))

  const headerInitials = (
    <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-xs font-bold text-navy-950 ring-1 ring-mist-100">
      {initials(otherName)}
    </div>
  )
  const headerAvatar = otherAvatarUrl ? (
    <MediaImage avatar src={otherAvatarUrl} alt="" width={44} height={44} sizes="44px" loading="eager" className="size-11 shrink-0 rounded-2xl object-cover ring-1 ring-mist-100" fallback={headerInitials} />
  ) : headerInitials

  return (
    <section ref={threadRef} className="flex min-h-0 flex-1 flex-col bg-[linear-gradient(180deg,white,var(--mist-50))]">
      <header className={`flex min-h-18 items-center gap-3 border-b border-mist-100 bg-white px-4 py-3 sm:px-5 ${hideHeaderOnPhones ? 'max-md:hidden' : ''}`}>
        <Link
          href="/messages"
          aria-label="Back to messages"
          className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-xl border border-mist-200 bg-white text-navy-900 transition hover:bg-mist-50 hover:text-ocean-800 md:hidden"
        >
          <ArrowLeft aria-hidden="true" className="size-4.5" />
        </Link>
        {profileHref ? (
          <Link
            href={profileHref}
            aria-label={`View ${name}'s profile`}
            data-testid="thread-peer-avatar-link"
            className="shrink-0 cursor-pointer rounded-2xl transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
          >
            {headerAvatar}
          </Link>
        ) : headerAvatar}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-bold text-navy-950 sm:text-lg">
            {profileHref ? (
              <Link
                href={profileHref}
                className="cursor-pointer rounded-sm hover:text-ocean-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
              >
                {name}
              </Link>
            ) : name}
          </h2>
          <p className="truncate text-xs text-muted sm:text-sm">{otherHeadline ?? 'Maritime professional'}</p>
        </div>
        <ConversationActionsMenu
          conversationId={conversationId}
          otherName={name}
          onDeleted={(result) => {
            if (result.unreadCount != null) publishMessagingUnreadCount(result.unreadCount)
            if (onConversationDeleted) {
              onConversationDeleted(result)
              return
            }
            router.push('/messages')
            router.refresh()
          }}
        />
      </header>

      <div data-testid="message-scroll-area" className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-5 sm:px-6">
        {nextCursor ? (
          <div className="mb-5 flex justify-center">
            <p className="text-xs text-muted">
              Showing your most recent messages
            </p>
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
              const next = messages[index + 1]
              const showIncomingAvatar = !mine && (
                !next
                || next.senderProfileId === viewerId
                || dayKey(next.createdAt) !== dayKey(message.createdAt)
              )
              const myReaction = (message.reactions ?? []).find((reaction) => reaction.profileId === viewerId)?.emoji ?? null
              const canonicalForReply = !('deliveryState' in message) ? message : null
              const canEdit = Boolean(
                mine
                && canonicalForReply
                && message.body
                && isWithinMessageEditWindow(message.createdAt, editWindowNow),
              )
              const isEditing = editingMessageId === message.id

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
                      <div className="mb-5 flex items-center gap-1 opacity-100 transition max-md:hidden sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
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
                            className="grid size-8 cursor-pointer place-items-center rounded-full border border-mist-200 bg-white text-muted shadow-sm transition hover:border-ocean-200 hover:bg-ocean-50 hover:text-ocean-700"
                          >
                            <Reply aria-hidden="true" className="size-4" />
                          </button>
                        ) : null}
                      </div>
                    ) : null}

                    {!mine ? (
                      showIncomingAvatar ? (
                        profileHref ? (
                          <Link
                            href={profileHref}
                            aria-label={`View ${name}'s profile`}
                            className="mb-5 shrink-0 cursor-pointer rounded-full transition hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
                          >
                            {incomingAvatar(message.id)}
                          </Link>
                        ) : (
                          <span className="mb-5 shrink-0">{incomingAvatar(message.id)}</span>
                        )
                      ) : (
                        <span aria-hidden="true" className="mb-5 size-7 shrink-0" />
                      )
                    ) : null}

                    <div className={`max-w-[86%] sm:max-w-[72%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div
                        data-testid={`message-bubble-${message.id}`}
                        onPointerDown={isEditing || message.deletedAt ? undefined : (event) => startLongPress(event, message.id)}
                        onPointerMove={moveLongPress}
                        onPointerUp={clearLongPress}
                        onPointerCancel={clearLongPress}
                        onPointerLeave={clearLongPress}
                        onContextMenu={isEditing || message.deletedAt ? undefined : (event) => onBubbleContextMenu(event, message.id)}
                        onClickCapture={onBubbleClickCapture}
                        className={`w-full rounded-2xl px-3.5 py-2.5 text-sm leading-6 shadow-sm max-md:text-[15px] max-md:[-webkit-touch-callout:none] max-md:select-none ${
                        mine
                          ? 'rounded-br-md bg-navy-900 text-white max-md:bg-ocean-700'
                          : 'rounded-bl-md border border-mist-100 bg-white text-navy-950 max-md:border-transparent max-md:bg-mist-100'
                      }`}>
                        <ReplyPreview message={message} mine={mine} />
                        <AttachmentCard message={message} mine={mine} onOpenImage={setLightboxImageId} />
                        {isEditing ? (
                          <div className="min-w-[15rem]">
                            <textarea
                              aria-label="Edit message text"
                              value={editBody}
                              onChange={(event) => setEditBody(event.target.value)}
                              maxLength={5000}
                              rows={3}
                              autoFocus
                              className="w-full resize-none rounded-xl border border-white/20 bg-white px-3 py-2 text-sm leading-5 text-navy-950 outline-none focus:border-ocean-400"
                            />
                            <div className="mt-2 flex justify-end gap-2">
                              <button
                                type="button"
                                aria-label="Cancel edit"
                                onClick={cancelEdit}
                                className="min-h-8 cursor-pointer rounded-lg border border-white/30 bg-white/10 px-3 text-[11px] font-semibold text-white hover:bg-white/20"
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                aria-label="Save edit"
                                disabled={!editBody.trim() || pendingMessageId === message.id}
                                onClick={() => void saveEdit(message.id)}
                                className="min-h-8 cursor-pointer rounded-lg bg-white px-3 text-[11px] font-bold text-navy-950 hover:bg-mist-100 disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Save
                              </button>
                            </div>
                          </div>
                        ) : message.body ? (
                          <p className="whitespace-pre-wrap break-words"><LinkifiedText text={message.body} /></p>
                        ) : null}
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
                              className={`inline-flex min-h-7 min-w-8 cursor-pointer items-center justify-center gap-0.5 rounded-lg bg-navy-950/90 px-1.5 py-0.5 text-sm leading-none text-white shadow-sm backdrop-blur-sm transition hover:scale-105 hover:bg-navy-950 ${
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
                        {message.editedAt ? <span>Edited</span> : null}
                        {mine && state === 'sending' ? <><Clock3 aria-hidden="true" className="size-3" /><span>Sending</span></> : null}
                        {mine && state === 'failed' ? <><RefreshCcw aria-hidden="true" className="size-3" /><span>Not sent</span></> : null}
                        {canonicalStatus === 'Sent' ? <><Check aria-hidden="true" className="size-3" /><span>Sent</span></> : null}
                        {canonicalStatus === 'Seen' ? <><CheckCheck aria-hidden="true" className="size-3" /><span>Seen</span></> : null}
                      </div>
                      {!message.deletedAt && !isEditing ? (
                        // Phones: screen-reader and switch users reach the long-press sheet from here.
                        <button
                          type="button"
                          aria-haspopup="dialog"
                          aria-label={`Options for message ${message.id}`}
                          onClick={() => openMessageSheet(message.id)}
                          className="sr-only focus:not-sr-only focus:mt-1 focus:rounded-full focus:border focus:border-mist-200 focus:px-3 focus:py-1 focus:text-xs md:hidden"
                        >
                          Message options
                        </button>
                      ) : null}
                    </div>

                    {mine ? (
                      <div className="mb-5 flex items-center gap-1 opacity-100 transition max-md:hidden sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                        {canonicalForReply && onReply ? (
                          <button
                            type="button"
                            aria-label={`Reply to message ${message.id}`}
                            onClick={() => onReply(canonicalForReply)}
                            className="grid size-8 cursor-pointer place-items-center rounded-full border border-mist-200 bg-white text-muted shadow-sm transition hover:border-ocean-200 hover:bg-ocean-50 hover:text-ocean-700"
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
                          <details data-dismissible-menu className="relative">
                            <summary
                              role="button"
                              aria-label={`More actions for message ${message.id}`}
                              className="grid size-8 cursor-pointer list-none place-items-center rounded-full border border-mist-200 bg-white text-muted shadow-sm transition hover:border-ocean-200 hover:bg-ocean-50 hover:text-navy-950"
                            >
                              <Ellipsis aria-hidden="true" className="size-4" />
                            </summary>
                            <div className="absolute bottom-full right-0 z-40 mb-2 min-w-44 rounded-xl border border-mist-100 bg-white p-1 shadow-xl">
                              {canEdit ? (
                                <button
                                  type="button"
                                  aria-label="Edit message"
                                  disabled={pendingMessageId === message.id}
                                  onClick={(event) => {
                                    const details = event.currentTarget.closest('details')
                                    if (details) details.open = false
                                    beginEdit(canonicalForReply)
                                  }}
                                  className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-navy-900 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-50"
                                >
                                  <Pencil aria-hidden="true" className="size-4" />
                                  Edit message
                                </button>
                              ) : null}
                              <button
                                type="button"
                                disabled={pendingMessageId === message.id}
                                onClick={() => void unsend(message.id)}
                                className="flex min-h-9 w-full cursor-pointer items-center gap-2 rounded-lg px-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
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
            <p data-testid="message-long-press-hint" className="mx-auto mt-3 flex items-center gap-2 rounded-full border border-dashed border-mist-300 px-3.5 py-1.5 text-xs text-muted md:hidden">
              <Smile aria-hidden="true" className="size-4 shrink-0" />
              Long-press a message to react, reply, edit or unsend
            </p>
            {otherTyping ? (
              <div data-testid="typing-indicator" className="mt-2 flex items-end gap-2">
                {otherAvatarUrl ? (
                  <MediaImage
                    avatar
                    data-testid="typing-avatar"
                    src={otherAvatarUrl}
                    alt=""
                    width={28}
                    height={28}
                    sizes="28px"
                    className="size-7 shrink-0 rounded-full object-cover ring-1 ring-mist-100"
                    fallback={incomingInitials('typing-avatar')}
                  />
                ) : incomingInitials('typing-avatar')}
                <div
                  aria-label={`${name} is typing`}
                  className="flex h-9 items-center gap-1 rounded-2xl rounded-bl-md border border-mist-100 bg-white px-3 shadow-sm"
                >
                  <span className="size-1.5 animate-pulse rounded-full bg-muted" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:120ms]" />
                  <span className="size-1.5 animate-pulse rounded-full bg-muted [animation-delay:240ms]" />
                </div>
              </div>
            ) : null}
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
      <BottomSheet open={Boolean(sheetMessage)} onClose={closeSheet} title="Message" desktop="hidden">
        {sheetMessage ? (() => {
          const mine = sheetMessage.senderProfileId === viewerId
          const canonical = !('deliveryState' in sheetMessage) ? sheetMessage : null
          const myReaction = (sheetMessage.reactions ?? []).find((reaction) => reaction.profileId === viewerId)?.emoji ?? null
          const canEdit = Boolean(mine && canonical && sheetMessage.body && isWithinMessageEditWindow(sheetMessage.createdAt, editWindowNow))
          const busy = pendingMessageId === sheetMessage.id
          return (
            <div role="menu" aria-label="Message actions">
              {canonical ? (
                <div role="group" aria-label="Reactions" className="flex items-center justify-between gap-1 px-2 pb-2 pt-1">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={`React with ${emoji}`}
                      aria-pressed={myReaction === emoji}
                      disabled={busy}
                      onClick={() => {
                        closeSheet()
                        void react(sheetMessage.id, myReaction === emoji ? null : emoji)
                      }}
                      className="grid size-12 cursor-pointer place-items-center rounded-full text-2xl transition hover:bg-mist-100 focus-visible:outline-2 focus-visible:outline-ocean-500 disabled:opacity-50 aria-pressed:bg-ocean-50"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              ) : null}
              {canonical && onReply ? (
                <SheetRow
                  role="menuitem"
                  icon={<Reply aria-hidden="true" />}
                  label="Reply"
                  onClick={() => {
                    closeSheet()
                    onReply(canonical)
                  }}
                />
              ) : null}
              {sheetMessage.body ? (
                <SheetRow
                  role="menuitem"
                  icon={<Copy aria-hidden="true" />}
                  label={copiedMessageId === sheetMessage.id ? 'Copied' : 'Copy text'}
                  onClick={() => void copyMessageText(sheetMessage)}
                />
              ) : null}
              {canEdit && canonical ? (
                <SheetRow
                  role="menuitem"
                  icon={<Pencil aria-hidden="true" />}
                  label="Edit message"
                  disabled={busy}
                  onClick={() => {
                    closeSheet()
                    beginEdit(canonical)
                  }}
                />
              ) : null}
              {mine && canonical ? (
                <SheetRow
                  role="menuitem"
                  tone="danger"
                  icon={<Trash2 aria-hidden="true" />}
                  label="Unsend message"
                  disabled={busy}
                  onClick={() => {
                    closeSheet()
                    void unsend(sheetMessage.id)
                  }}
                />
              ) : null}
            </div>
          )
        })() : null}
      </BottomSheet>
      <ImageLightbox
        images={lightboxImages}
        activeId={lightboxImageId}
        onActiveIdChange={setLightboxImageId}
        onClose={closeLightbox}
      />
    </section>
  )
}
