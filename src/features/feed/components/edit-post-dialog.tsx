'use client'

import { useId, useRef, useState, useTransition, type RefObject } from 'react'
import { updatePost, type UpdatePostActionResult } from '../actions'
import type { FeedMention, FeedOrganizationMention, FeedPostType } from '../types'
import { EmojiPicker, insertEmojiAt } from './emoji-picker'
import { FeedDialog } from './feed-dialog'
import { MentionInput, mentionKind, type SelectedMention } from './mention-input'

const POST_MAX = 5000
const REPOST_MAX = 3000

type SavedPost = Extract<UpdatePostActionResult, { ok: true }>['post']

/** Members and organization pages already tagged in the post, as the mention picker tracks them. */
export function selectedPostMentions(mentions: FeedMention[], organizationMentions: FeedOrganizationMention[] = []): SelectedMention[] {
  return [
    ...mentions.map((mention): SelectedMention => ({ kind: 'member', profileId: mention.profileId, label: mention.fullName })),
    ...organizationMentions.map((organization): SelectedMention => ({
      kind: 'organization',
      profileId: organization.companyId,
      label: organization.name,
      slug: organization.slug,
      logoUrl: organization.logoUrl,
    })),
  ]
}

/** Edits the text of a post. Poll options, media and the original of a repost stay as they are. */
export function EditPostDialog({
  postId,
  postType,
  body: initialBody,
  mentions: initialMentions,
  organizationMentions: initialOrganizationMentions = [],
  publishedAs,
  onClose,
  onSaved,
  returnFocusRef,
}: {
  postId: string
  postType: FeedPostType
  body: string
  mentions: FeedMention[]
  /** Organization pages tagged with "@" (round 9B). */
  organizationMentions?: FeedOrganizationMention[]
  /** Name shown as the post's author, e.g. the organization's name. */
  publishedAs: string
  onClose(): void
  /** The saved text and member mentions, plus the organization mentions still in the text. */
  onSaved(post: SavedPost, organizationMentions: FeedOrganizationMention[]): void
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const inputId = useId()
  const counterId = useId()
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const [body, setBody] = useState(initialBody)
  const [mentions, setMentions] = useState<SelectedMention[]>(() => selectedPostMentions(initialMentions, initialOrganizationMentions))
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const isRepost = postType === 'repost'
  const max = isRepost ? REPOST_MAX : POST_MAX
  const remaining = max - body.length
  const unchanged = body.trim() === initialBody.trim()

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
    const text = body.trim()
    if (!text && !isRepost) {
      setError('Write something before saving, or delete the post from its ⋯ menu.')
      return
    }
    if (text.length > max) {
      setError(`Keep ${isRepost ? 'your thoughts' : 'the post'} to ${max.toLocaleString('en')} characters or fewer.`)
      return
    }
    setError('')
    startTransition(async () => {
      const present = mentions.filter((mention) => text.includes(`@${mention.label}`))
      const organizationMentions = present.filter((mention) => mentionKind(mention) === 'organization')
      const result = await updatePost({
        postId,
        body: text,
        mentionProfileIds: present.filter((mention) => mentionKind(mention) === 'member').map((mention) => mention.profileId),
        organizationMentionIds: organizationMentions.map((mention) => mention.profileId),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      onSaved(result.post, organizationMentions.map((mention) => ({
        companyId: mention.profileId,
        slug: mention.slug ?? '',
        name: mention.label,
        logoUrl: mention.logoUrl ?? null,
      })))
      onClose()
    })
  }

  return (
    <FeedDialog
      title="Edit post"
      description={postType === 'poll'
        ? `Posting as ${publishedAs}. You can change the text; poll options stay the same so votes keep counting.`
        : isRepost
          ? `Posting as ${publishedAs}. Change or remove your thoughts; the original post stays attached.`
          : `Posting as ${publishedAs}. Photos, videos and documents stay attached.`}
      onClose={() => { if (!pending) onClose() }}
      closeLabel="Close without saving"
      returnFocusRef={returnFocusRef}
      initialFocusSelector="textarea"
    >
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <label htmlFor={inputId} className="sr-only">{isRepost ? 'Your thoughts' : 'Post text'}</label>
        <MentionInput
          id={inputId}
          name="body"
          rows={6}
          value={body}
          onChange={(value) => { setBody(value); if (error) setError('') }}
          mentions={mentions}
          onMentionsChange={setMentions}
          textareaRef={textareaRef}
          maxLength={max}
          describedBy={counterId}
          placeholder={isRepost ? 'Add your thoughts (optional)…' : 'Share an update, insight or lesson…'}
          className="min-h-40 w-full resize-y rounded-xl border border-mist-100 bg-white px-3 py-2.5 text-sm leading-6 text-ink outline-none placeholder:text-muted focus:border-ocean-500"
        />
        <div className="mt-1 flex items-center justify-between gap-2">
          <EmojiPicker onSelect={insertEmoji} label="Add emoji to post" size="sm" />
          <p id={counterId} aria-live="polite" className={`text-xs ${remaining < 100 ? 'text-amber-700' : 'text-muted'}`}>{remaining.toLocaleString('en')} characters left</p>
        </div>
        {error ? <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={pending} className="min-h-10 cursor-pointer rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={pending || unchanged} className="min-h-10 cursor-pointer rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900 disabled:cursor-not-allowed disabled:bg-mist-100 disabled:text-muted">
            {pending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </FeedDialog>
  )
}
