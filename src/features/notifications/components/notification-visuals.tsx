import { Bell, Play } from 'lucide-react'
import Link from 'next/link'
import { AuthorAvatarLink } from '@/features/feed/components/author-avatar'
import type { NetworkNotification } from '../types'

/**
 * The actor's round profile photo (initials when there is none) that opens their profile.
 * Notifications without a known actor get a neutral bell tile.
 */
export function NotificationActorAvatar({ notification, size = 'size-11' }: {
  notification: NetworkNotification
  size?: 'size-10' | 'size-11'
}) {
  if (!notification.actor) {
    return (
      <span aria-hidden="true" className={`grid ${size} shrink-0 place-items-center rounded-full bg-mist-100 text-navy-700`}>
        <Bell className="size-4" />
      </span>
    )
  }
  return <AuthorAvatarLink author={notification.actor} className={`${size} rounded-full text-xs`} />
}

/**
 * Small square preview of the post a notification is about: its first photo or video, or the
 * first words of its text. Opens the post.
 */
export function NotificationPostThumb({ notification, size = 'size-12', onOpen }: {
  notification: NetworkNotification
  size?: 'size-11' | 'size-12'
  onOpen?(): void
}) {
  const preview = notification.postPreview
  if (!preview) return null
  const actorName = notification.actor?.fullName
  return (
    <Link
      href={`/posts/${preview.postId}`}
      onClick={onOpen}
      aria-label={preview.text ? `Open post: ${preview.text}` : 'Open post'}
      title={actorName ? `Open the post ${actorName} interacted with` : 'Open post'}
      data-testid={`notification-preview-${notification.id}`}
      className={`relative block ${size} shrink-0 overflow-hidden rounded-lg bg-mist-100 ring-1 ring-mist-200 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/50`}
    >
      {preview.mediaUrl && preview.mediaType === 'video' ? (
        <>
          <video src={preview.mediaUrl} preload="metadata" muted playsInline aria-hidden="true" tabIndex={-1} className="h-full w-full object-cover" />
          <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-navy-950/20 text-white"><Play className="size-4 fill-current" /></span>
        </>
      ) : preview.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- first-party feed media route
        <img src={preview.mediaUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true" className="block h-full w-full overflow-hidden break-words p-1 text-left text-[9px] font-medium leading-[11px] text-navy-900 [overflow-wrap:anywhere]">
          {preview.text || 'Post'}
        </span>
      )}
    </Link>
  )
}
