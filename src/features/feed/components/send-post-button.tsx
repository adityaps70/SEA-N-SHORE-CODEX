'use client'

import { Send } from 'lucide-react'
import { useRef, useState } from 'react'
import { POST_ACTION_BUTTON_CLASS, POST_ACTION_LABEL_CLASS } from './post-action-styles'
import { SendPostDialog } from './send-post-dialog'
import type { FeedNotice } from './share-utils'

/** Action-row "Send" button: shares the post with a connection as a direct message. */
export function SendPostButton({
  postId,
  authorName,
  onNotice,
  variant = 'default',
}: {
  postId: string
  authorName: string
  onNotice?(notice: FeedNotice): void
  /** 'action': bordered, labelled button of the post action row. */
  variant?: 'default' | 'action'
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label="Send"
        title="Send in a message"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={variant === 'action'
          ? POST_ACTION_BUTTON_CLASS
          : 'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl px-2 text-sm font-semibold text-navy-900 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40'}
      >
        <Send aria-hidden="true" className="size-5" />
        {variant === 'action' ? <span className={POST_ACTION_LABEL_CLASS}>Send</span> : null}
      </button>
      {open ? (
        <SendPostDialog postId={postId} authorName={authorName} onClose={() => setOpen(false)} onNotice={onNotice} returnFocusRef={triggerRef} />
      ) : null}
    </>
  )
}
