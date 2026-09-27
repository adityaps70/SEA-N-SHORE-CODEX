'use client'

import { useId, useRef, useState, useTransition, type RefObject } from 'react'
import { repostPost } from '../actions'
import { EmojiPicker, insertEmojiAt } from './emoji-picker'
import { FeedDialog } from './feed-dialog'
import { MentionInput, type SelectedMention } from './mention-input'
import type { FeedNotice } from './share-utils'

const COMMENTARY_MAX = 3000

export type RepostSourcePreview = {
  authorName: string
  body: string
}

/** "Repost with your thoughts": adds the member's commentary above the original post. */
export function RepostDialog({
  postId,
  source,
  onClose,
  onNotice,
  returnFocusRef,
}: {
  postId: string
  source: RepostSourcePreview
  onClose(): void
  onNotice?(notice: FeedNotice): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const inputId = useId()
  const counterId = useId()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [body, setBody] = useState('')
  const [mentions, setMentions] = useState<SelectedMention[]>([])
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const remaining = COMMENTARY_MAX - body.length

  function insertEmoji(emoji: string) {
    const textarea = textareaRef.current
    const next = insertEmojiAt(body, emoji, textarea?.selectionStart, textarea?.selectionEnd)
    setBody(next.value)
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(next.caret, next.caret)
    })
  }

  function submit() {
    if (pending) return
    const commentary = body.trim()
    if (!commentary) {
      setError('Add your thoughts, or close this and choose “Repost to feed” to share it without a comment.')
      return
    }
    setError('')
    startTransition(async () => {
      const result = await repostPost(postId, { body: commentary, mentionProfileIds: mentions.map((mention) => mention.profileId) })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onNotice?.({ text: 'Reposted to your feed with your thoughts.', tone: 'success', href: `/posts/${result.postId}`, hrefLabel: 'View repost' })
      onClose()
    })
  }

  return (
    <FeedDialog
      title="Repost with your thoughts"
      description="Your comment appears above the original post in the Sea N Shore feed."
      onClose={onClose}
      closeLabel="Close repost dialog"
      returnFocusRef={returnFocusRef}
      initialFocusSelector="textarea"
    >
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label htmlFor={inputId} className="sr-only">Your thoughts</label>
        <MentionInput
          id={inputId}
          name="body"
          rows={4}
          value={body}
          onChange={(value) => { setBody(value); if (error) setError('') }}
          mentions={mentions}
          onMentionsChange={setMentions}
          textareaRef={textareaRef}
          maxLength={COMMENTARY_MAX}
          describedBy={counterId}
          placeholder="What do you think? Mention colleagues with @"
          className="min-h-28 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm text-ink outline-none placeholder:text-muted focus:border-ocean-500"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <EmojiPicker onSelect={insertEmoji} label="Add emoji to your thoughts" size="sm" />
          <p id={counterId} className={`text-xs ${remaining < 100 ? 'text-amber-700' : 'text-muted'}`}>{remaining.toLocaleString('en')} characters left</p>
        </div>

        <section aria-label={`Original post by ${source.authorName}`} className="mt-3 rounded-2xl border border-mist-100 bg-mist-50/60 px-4 py-3">
          <p className="text-xs font-semibold text-navy-950">{source.authorName}</p>
          <p className="mt-1 line-clamp-3 text-sm leading-6 text-muted [overflow-wrap:anywhere]">{source.body.trim() || 'Media post'}</p>
        </section>

        {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="min-h-10 rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={pending} className="min-h-10 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:opacity-60">
            {pending ? 'Reposting…' : 'Repost'}
          </button>
        </div>
      </form>
    </FeedDialog>
  )
}
