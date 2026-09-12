'use client'

import { useState, type FormEvent, type KeyboardEvent } from 'react'
import { SendHorizontal } from 'lucide-react'
import { sendMessageAction } from '../actions'
import type { MessagingMessageDto } from '../queries'

export type OptimisticMessagingMessage = MessagingMessageDto & {
  deliveryState: 'sending' | 'failed'
  error?: string
}

type MessageComposerProps = {
  conversationId: string
  viewerId: string
  onOptimisticMessage: (message: OptimisticMessagingMessage) => void
  onMessageConfirmed: (clientMessageId: string, message: MessagingMessageDto) => void
  onMessageFailed: (clientMessageId: string, error: string) => void
}

export function MessageComposer({
  conversationId,
  viewerId,
  onOptimisticMessage,
  onMessageConfirmed,
  onMessageFailed,
}: MessageComposerProps) {
  const [body, setBody] = useState('')
  const [sendingCount, setSendingCount] = useState(0)

  async function submitMessage() {
    const normalized = body.trim()
    if (!normalized) return

    const clientMessageId = crypto.randomUUID()
    const optimistic: OptimisticMessagingMessage = {
      id: clientMessageId,
      conversationId,
      senderProfileId: viewerId,
      clientMessageId,
      body: normalized,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deletedAt: null,
      deliveryState: 'sending',
    }

    onOptimisticMessage(optimistic)
    setBody('')
    setSendingCount((count) => count + 1)

    try {
      const result = await sendMessageAction({
        conversationId,
        clientMessageId,
        body: normalized,
      })
      if (result.ok) {
        onMessageConfirmed(clientMessageId, result.message)
      } else {
        onMessageFailed(clientMessageId, result.error)
      }
    } catch {
      onMessageFailed(clientMessageId, 'Unable to send right now.')
    } finally {
      setSendingCount((count) => Math.max(0, count - 1))
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submitMessage()
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  return (
    <form onSubmit={onSubmit} className="border-t border-mist-100 bg-white p-3 sm:p-4">
      <div className="flex items-end gap-2 rounded-2xl border border-mist-100 bg-mist-50 p-2 transition focus-within:border-teal-500">
        <label htmlFor="message-composer" className="sr-only">Write a message</label>
        <textarea
          id="message-composer"
          aria-label="Write a message"
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          maxLength={4000}
          placeholder="Write a message…"
          className="max-h-36 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-sm leading-5 text-navy-950 outline-none placeholder:text-muted"
        />
        <button
          type="submit"
          aria-label="Send message"
          title={sendingCount > 0 ? 'Sending message' : 'Send message'}
          disabled={!body.trim()}
          className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-700 text-white transition hover:bg-ocean-800 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted"
        >
          <SendHorizontal aria-hidden="true" className="size-4.5" />
        </button>
      </div>
      <p className="mt-1.5 px-1 text-[11px] text-muted">Enter to send · Shift + Enter for a new line</p>
    </form>
  )
}
