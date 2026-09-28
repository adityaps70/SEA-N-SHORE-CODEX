'use client'

import { MessageSquarePlus, Pencil } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { NewMessageDialog, type NewMessageSelection } from './new-message-dialog'

/**
 * "New Message" on the full messages page. It opens a searchable picker of
 * accepted connections ("Choose a connection"); choosing someone reuses the
 * existing conversation or creates one through startDirectConversationAction,
 * then opens it.
 */
export function NewMessageButton({
  activeConversationId = null,
  debounceMs,
  variant = 'default',
}: {
  /** Conversation already open on the page; choosing it again just closes the picker. */
  activeConversationId?: string | null
  debounceMs?: number
  /** `icon`: the phone page bar's pencil button. */
  variant?: 'default' | 'icon'
} = {}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [targetPath, setTargetPath] = useState<string | null>(null)
  const [navigating, startNavigation] = useTransition()

  const close = useCallback(() => {
    setOpen(false)
    setTargetPath(null)
  }, [])

  const openConversation = useCallback(({ conversationId }: NewMessageSelection) => {
    if (conversationId === activeConversationId) {
      close()
      return
    }
    const path = `/messages/${conversationId}`
    setTargetPath(path)
    startNavigation(() => {
      router.push(path)
    })
  }, [activeConversationId, close, router])

  useEffect(() => {
    if (!targetPath || navigating) return
    // Navigation finished (or was superseded): close the picker.
    const timer = setTimeout(close, 0)
    return () => clearTimeout(timer)
  }, [close, navigating, targetPath])

  return (
    <>
      {variant === 'icon' ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label="Write a new message"
          className="grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 transition hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
        >
          <Pencil aria-hidden="true" className="size-6" />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-expanded={open}
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white shadow-sm transition hover:bg-navy-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-600"
        >
          <MessageSquarePlus aria-hidden="true" className="size-4" /> New Message
        </button>
      )}
      <NewMessageDialog
        open={open}
        onClose={close}
        onConversationReady={openConversation}
        openingConversation={Boolean(targetPath)}
        debounceMs={debounceMs}
      />
    </>
  )
}
