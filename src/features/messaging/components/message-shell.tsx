'use client'

import { MessageCircleMore } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MessagingInboxItem, MessagingMessageDto } from '../queries'
import { ConversationList } from './conversation-list'
import { MessageComposer, type OptimisticMessagingMessage } from './message-composer'
import { MessageThread, type MessageThreadItem } from './message-thread'

export type MessagingActiveConversation = {
  conversationId: string
  otherProfileId: string
  otherName: string | null
  otherHeadline: string | null
  otherAvatarUrl: string | null
  messages: MessagingMessageDto[]
  nextCursor: { createdAt: string; id: string } | null
}

export function MessageShell({
  viewerId,
  inbox,
  activeConversation,
}: {
  viewerId: string
  inbox: MessagingInboxItem[]
  activeConversation: MessagingActiveConversation | null
}) {
  const [messages, setMessages] = useState<MessageThreadItem[]>(activeConversation?.messages ?? [])

  useEffect(() => {
    setMessages(activeConversation?.messages ?? [])
  }, [activeConversation?.conversationId, activeConversation?.messages])

  function addOptimistic(message: OptimisticMessagingMessage) {
    setMessages((current) => {
      const withoutRetry = current.filter((item) => item.clientMessageId !== message.clientMessageId)
      return [...withoutRetry, message]
    })
  }

  function confirmMessage(clientMessageId: string, canonical: MessagingMessageDto) {
    setMessages((current) => current.map((message) => (
      message.clientMessageId === clientMessageId ? canonical : message
    )))
  }

  function failMessage(clientMessageId: string, error: string) {
    setMessages((current) => current.map((message) => {
      if (message.clientMessageId !== clientMessageId) return message
      return {
        ...message,
        deliveryState: 'failed' as const,
        error,
      }
    }))
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Professional conversations</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">Messages</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">Stay connected with accepted maritime professionals through focused one-to-one conversations.</p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full border border-mist-100 bg-white px-3 py-1.5 text-xs font-semibold text-navy-900 shadow-sm">
          <MessageCircleMore aria-hidden="true" className="size-4 text-ocean-700" />
          {inbox.length} {inbox.length === 1 ? 'conversation' : 'conversations'}
        </div>
      </header>

      <div className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <div className="grid min-h-[38rem] md:h-[calc(100vh-13rem)] md:min-h-[38rem] md:grid-cols-[minmax(18rem,22rem)_minmax(0,1fr)]">
          <div className={activeConversation ? 'hidden min-h-0 md:block' : 'min-h-0'}>
            <ConversationList inbox={inbox} activeConversationId={activeConversation?.conversationId} />
          </div>

          <div className={activeConversation ? 'flex min-h-0 flex-col' : 'hidden min-h-0 md:flex md:flex-col'}>
            {activeConversation ? (
              <>
                <MessageThread
                  viewerId={viewerId}
                  conversationId={activeConversation.conversationId}
                  otherName={activeConversation.otherName}
                  otherHeadline={activeConversation.otherHeadline}
                  otherAvatarUrl={activeConversation.otherAvatarUrl}
                  messages={messages}
                  nextCursor={activeConversation.nextCursor}
                />
                <MessageComposer
                  conversationId={activeConversation.conversationId}
                  viewerId={viewerId}
                  onOptimisticMessage={addOptimistic}
                  onMessageConfirmed={confirmMessage}
                  onMessageFailed={failMessage}
                />
              </>
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
