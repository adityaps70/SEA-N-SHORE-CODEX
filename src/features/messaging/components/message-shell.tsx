'use client'

import { MessageCircleMore } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { NetworkProfile } from '@/features/network/types'
import { useMessagingRealtime } from '@/features/realtime/provider'
import type { MessagingInboxItem, MessagingMessageDto } from '../queries'
import {
  fetchConversationCatchUp,
  laterReadCursor,
  latestCanonicalCursor,
  mergeCanonicalMessages,
  type MessagingReadCursor,
} from '../thread-realtime'
import { ConversationList } from './conversation-list'
import { MessageComposer, type OptimisticMessagingMessage } from './message-composer'
import { MessageThread, type MessageThreadItem } from './message-thread'
import { NewMessageButton } from './new-message-button'

export type MessagingActiveConversation = {
  conversationId: string
  otherProfileId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  otherLastReadMessageId: string | null
  otherLastReadAt: string | null
  messages: MessagingMessageDto[]
  nextCursor: { createdAt: string; id: string } | null
}

function peerCursorFromConversation(conversation: MessagingActiveConversation): MessagingReadCursor | null {
  if (!conversation.otherLastReadMessageId || !conversation.otherLastReadAt) return null
  return {
    createdAt: conversation.otherLastReadAt,
    id: conversation.otherLastReadMessageId,
  }
}

function ActiveConversationWorkspace({
  viewerId,
  conversation,
}: {
  viewerId: string
  conversation: MessagingActiveConversation
}) {
  const { subscribe } = useMessagingRealtime()
  const [messages, setMessages] = useState<MessageThreadItem[]>(conversation.messages)
  const [peerReadCursor, setPeerReadCursor] = useState<MessagingReadCursor | null>(null)
  const messagesRef = useRef<MessageThreadItem[]>(conversation.messages)
  const catchUpRunningRef = useRef(false)
  const catchUpPendingRef = useRef(false)
  const displayedMessages = mergeCanonicalMessages(messages, conversation.messages)
  const effectivePeerReadCursor = laterReadCursor(
    peerReadCursor,
    peerCursorFromConversation(conversation),
  )

  function updateMessages(updater: (current: MessageThreadItem[]) => MessageThreadItem[]) {
    setMessages((current) => {
      const next = updater(current)
      messagesRef.current = next
      return next
    })
  }

  useEffect(() => {
    let cancelled = false

    async function catchUpActiveConversation() {
      if (catchUpRunningRef.current) {
        catchUpPendingRef.current = true
        return
      }

      catchUpRunningRef.current = true
      try {
        do {
          catchUpPendingRef.current = false
          const cursor = latestCanonicalCursor(
            mergeCanonicalMessages(messagesRef.current, conversation.messages),
          )
          if (!cursor) return

          try {
            const incoming = await fetchConversationCatchUp(conversation.conversationId, cursor)
            if (!cancelled && incoming.length) {
              updateMessages((current) => mergeCanonicalMessages(current, incoming))
            }
          } catch {
            // The global realtime provider also refreshes canonical server props.
            // Direct catch-up is an acceleration path, never the source of truth.
          }
        } while (!cancelled && catchUpPendingRef.current)
      } finally {
        catchUpRunningRef.current = false
      }
    }

    const unsubscribe = subscribe((signal) => {
      if (signal.eventType === 'message.created') {
        if (signal.payload.conversationId !== conversation.conversationId) return
        void catchUpActiveConversation()
        return
      }

      if (signal.eventType !== 'conversation.read_cursor_advanced') return
      if (signal.payload.conversationId !== conversation.conversationId) return

      if (signal.payload.readerProfileId === conversation.otherProfileId) {
        setPeerReadCursor((current) => laterReadCursor(current, {
          createdAt: signal.payload.lastReadAt,
          id: signal.payload.lastReadMessageId,
        }))
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [conversation.conversationId, conversation.messages, conversation.otherProfileId, subscribe])

  function addOptimistic(message: OptimisticMessagingMessage) {
    updateMessages((current) => {
      const withoutRetry = current.filter((item) => item.clientMessageId !== message.clientMessageId)
      return [...withoutRetry, message]
    })
  }

  function confirmMessage(clientMessageId: string, canonical: MessagingMessageDto) {
    updateMessages((current) => current.map((message) => (
      message.clientMessageId === clientMessageId ? canonical : message
    )))
  }

  function failMessage(clientMessageId: string, error: string) {
    updateMessages((current) => current.map((message) => {
      if (message.clientMessageId !== clientMessageId) return message
      return {
        ...message,
        deliveryState: 'failed' as const,
        error,
      }
    }))
  }

  return (
    <>
      <MessageThread
        viewerId={viewerId}
        conversationId={conversation.conversationId}
        otherName={conversation.otherName}
        otherHeadline={conversation.otherHeadline}
        otherAvatarUrl={conversation.otherAvatarUrl}
        messages={displayedMessages}
        nextCursor={conversation.nextCursor}
        peerReadCursor={effectivePeerReadCursor}
      />
      <MessageComposer
        conversationId={conversation.conversationId}
        viewerId={viewerId}
        onOptimisticMessage={addOptimistic}
        onMessageConfirmed={confirmMessage}
        onMessageFailed={failMessage}
      />
    </>
  )
}

export function MessageShell({
  viewerId,
  inbox,
  activeConversation,
  newMessageCandidates = [],
}: {
  viewerId: string
  inbox: MessagingInboxItem[]
  activeConversation: MessagingActiveConversation | null
  newMessageCandidates?: NetworkProfile[]
}) {
  const unreadCount = inbox.filter((item) => item.unread).length

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Professional conversations</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">Messages</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Stay connected with accepted maritime professionals through focused one-to-one conversations.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex w-fit items-center gap-2 rounded-full border border-mist-100 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 shadow-sm">
            <MessageCircleMore aria-hidden="true" className="size-4 text-ocean-700" />
            {unreadCount ? `${unreadCount} unread` : `${inbox.length} ${inbox.length === 1 ? 'conversation' : 'conversations'}`}
          </span>
          <NewMessageButton candidates={newMessageCandidates} />
        </div>
      </header>

      <div className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="grid min-h-[38rem] md:h-[calc(100vh-13rem)] md:min-h-[38rem] md:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <div className={activeConversation ? 'hidden min-h-0 md:block' : 'min-h-0'}>
            <ConversationList inbox={inbox} activeConversationId={activeConversation?.conversationId} />
          </div>

          <div className={activeConversation ? 'flex min-h-0 flex-col' : 'hidden min-h-0 md:flex md:flex-col'}>
            {activeConversation ? (
              <ActiveConversationWorkspace
                key={activeConversation.conversationId}
                viewerId={viewerId}
                conversation={activeConversation}
              />
            ) : (
              <div className="grid min-h-full flex-1 place-items-center bg-[linear-gradient(180deg,white,var(--mist-50))] p-8 text-center">
                <div className="max-w-md">
                  <div className="mx-auto grid size-16 place-items-center rounded-[1.4rem] bg-ocean-50 text-ocean-700 ring-1 ring-ocean-100">
                    <MessageCircleMore aria-hidden="true" className="size-7" />
                  </div>
                  <h2 className="mt-5 text-xl font-bold text-navy-950">Select a conversation</h2>
                  <p className="mt-2 text-sm leading-6 text-muted">Choose a maritime professional from your inbox to continue a focused one-to-one conversation.</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
