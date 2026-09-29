'use client'

import { useCallback, useRef, useState, useTransition } from 'react'
import { ExternalLink, Link2, MessageSquareQuote, Repeat2, Send, Share2 } from 'lucide-react'
import { ActionMenu, ActionMenuItem } from '@/components/ui/action-menu'
import { repostPost } from '../actions'
import { FeedDialog } from './feed-dialog'
import { RepostDialog, type RepostSourcePreview } from './repost-dialog'
import { SendPostDialog } from './send-post-dialog'
import {
  copyToClipboard,
  externalShareTargets,
  nativeShareAvailable,
  postPermalink,
  shareWithDevice,
  type FeedNotice,
} from './share-utils'
import { POST_ACTION_BUTTON_CLASS, POST_ACTION_LABEL_CLASS } from './post-action-styles'

const SHARE_TEXT = 'View this maritime discussion on Sea N Shore.'

const itemClass = 'rounded-xl py-2.5'

function ExternalShareDialog({ url, onClose, onCopy }: { url: string; onClose(): void; onCopy(): void }) {
  return (
    <FeedDialog title="Share outside Sea N Shore" description="Choose where to share this post, or copy the link." onClose={onClose} closeLabel="Close share options" size="sm">
      <ul className="grid grid-cols-2 gap-2">
        {externalShareTargets(url, SHARE_TEXT).map((target) => (
          <li key={target.id}>
            <a
              href={target.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onClose}
              className="flex min-h-11 items-center justify-between gap-2 rounded-xl border border-mist-200 px-3 text-sm font-semibold text-navy-950 hover:border-ocean-300 hover:bg-mist-50"
            >
              {target.label}
              <ExternalLink aria-hidden="true" className="size-3.5 text-muted" />
            </a>
          </li>
        ))}
      </ul>
      <button type="button" onClick={onCopy} className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-navy-900">
        <Link2 aria-hidden="true" className="size-4" /> Copy link
      </button>
    </FeedDialog>
  )
}

/**
 * Repost / share control for a feed post: repost, repost with thoughts, send in a
 * message, share with the device share sheet (or share links as a fallback) and copy link.
 */
export function SharePostButton({
  postId,
  repostPostId,
  authorName = 'this member',
  source,
  iconOnly = false,
  variant = 'default',
  allowRepost = true,
  allowSend = true,
  menuAlign = 'center',
  onNotice,
}: {
  /** The post the link points at. */
  postId: string
  /** The original post a repost should point at (defaults to postId). */
  repostPostId?: string
  authorName?: string
  source?: RepostSourcePreview
  iconOnly?: boolean
  /** 'action': bordered button of the post action row, labelled Repost (or Share). */
  variant?: 'default' | 'action'
  allowRepost?: boolean
  allowSend?: boolean
  /** Where the menu opens relative to the button; use 'start' near the card's left edge. */
  menuAlign?: 'center' | 'start'
  /** Shows results in the post card. Without it the button shows its own status line. */
  onNotice?(notice: FeedNotice): void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)
  const closeMenu = useCallback(() => setMenuOpen(false), [])
  const toggleMenu = useCallback(() => setMenuOpen((value) => !value), [])
  const [dialog, setDialog] = useState<'repost' | 'send' | 'external' | null>(null)
  const [ownNotice, setOwnNotice] = useState<FeedNotice | null>(null)
  const [pending, startTransition] = useTransition()
  const repostTarget = repostPostId ?? postId
  const actionLabel = allowRepost ? 'Repost' : 'Share'

  function notify(notice: FeedNotice) {
    if (onNotice) onNotice(notice)
    else setOwnNotice(notice)
  }

  function openDialog(next: 'repost' | 'send' | 'external') {
    closeMenu()
    setDialog(next)
  }

  function repost() {
    if (!allowRepost || pending) return
    startTransition(async () => {
      const result = await repostPost(repostTarget)
      closeMenu()
      notify(result.ok
        ? { text: 'Reposted to your feed.', tone: 'success', href: `/posts/${result.postId}`, hrefLabel: 'View repost' }
        : { text: result.error, tone: 'error' })
    })
  }

  async function copyLink() {
    closeMenu()
    setDialog(null)
    const copied = await copyToClipboard(postPermalink(postId))
    notify(copied
      ? { text: 'Link copied. Paste it anywhere to share this post.', tone: 'success' }
      : { text: `We could not copy automatically. Copy this link instead: ${postPermalink(postId)}`, tone: 'error' })
  }

  async function shareExternally() {
    if (!nativeShareAvailable()) {
      openDialog('external')
      return
    }
    closeMenu()
    const outcome = await shareWithDevice({ title: `${authorName} on Sea N Shore`, text: SHARE_TEXT, url: postPermalink(postId) })
    if (outcome === 'unavailable') setDialog('external')
  }

  return (
    <div className="relative">
      {variant === 'action' ? (
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={toggleMenu}
          aria-label={actionLabel}
          title={allowRepost ? 'Repost or share' : 'Share'}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className={POST_ACTION_BUTTON_CLASS}
        >
          {allowRepost ? <Repeat2 aria-hidden="true" className="size-5" /> : <Share2 aria-hidden="true" className="size-5" />}
          <span className={POST_ACTION_LABEL_CLASS}>{actionLabel}</span>
        </button>
      ) : (
        <button
          ref={menuTriggerRef}
          type="button"
          onClick={toggleMenu}
          aria-label={iconOnly ? 'Share' : undefined}
          title="Repost or share"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-3 text-sm font-semibold text-navy-900 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/40"
        >
          {allowRepost ? <Repeat2 aria-hidden="true" className="size-5" /> : <Share2 aria-hidden="true" className="size-5" />}
          {iconOnly ? null : 'Share'}
        </button>
      )}

      {/* Opens above the action row (a bottom sheet on phones); portaled so a card never clips it. */}
      <ActionMenu
        open={menuOpen}
        onClose={closeMenu}
        anchorRef={menuTriggerRef}
        label="Share post"
        side="top"
        align={menuAlign === 'start' ? 'start' : 'center'}
        className="w-[min(17.5rem,calc(100vw-2rem))] rounded-2xl"
      >
        {allowRepost ? (
          <>
            <ActionMenuItem disabled={pending} onClick={repost} className={itemClass} icon={<Repeat2 aria-hidden="true" className="size-4" />}>
              {pending ? 'Reposting…' : 'Repost to feed'}
            </ActionMenuItem>
            <ActionMenuItem disabled={pending} onClick={() => openDialog('repost')} className={itemClass} icon={<MessageSquareQuote aria-hidden="true" className="size-4" />}>
              Repost with your thoughts
            </ActionMenuItem>
          </>
        ) : null}
        {allowSend ? (
          <ActionMenuItem onClick={() => openDialog('send')} className={itemClass} icon={<Send aria-hidden="true" className="size-4" />}>
            Send in a message
          </ActionMenuItem>
        ) : null}
        <ActionMenuItem onClick={() => { void shareExternally() }} className={itemClass} icon={<Share2 aria-hidden="true" className="size-4" />}>
          Share outside Sea N Shore
        </ActionMenuItem>
        <ActionMenuItem onClick={() => { void copyLink() }} className={itemClass} icon={<Link2 aria-hidden="true" className="size-4" />}>
          Copy link
        </ActionMenuItem>
      </ActionMenu>

      {!onNotice && ownNotice ? (
        <p role={ownNotice.tone === 'error' ? 'alert' : 'status'} className={`mt-1 text-xs font-semibold ${ownNotice.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>
          {ownNotice.text}
        </p>
      ) : null}

      {dialog === 'repost' ? (
        <RepostDialog
          postId={repostTarget}
          source={source ?? { authorName, body: '' }}
          onClose={() => setDialog(null)}
          onNotice={notify}
          returnFocusRef={menuTriggerRef}
        />
      ) : null}
      {dialog === 'send' ? (
        <SendPostDialog postId={postId} authorName={authorName} onClose={() => setDialog(null)} onNotice={notify} returnFocusRef={menuTriggerRef} />
      ) : null}
      {dialog === 'external' ? (
        <ExternalShareDialog url={postPermalink(postId)} onClose={() => setDialog(null)} onCopy={() => { void copyLink() }} />
      ) : null}
    </div>
  )
}
