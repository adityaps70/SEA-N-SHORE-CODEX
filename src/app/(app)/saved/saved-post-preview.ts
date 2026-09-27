import type { FeedMedia, FeedPost } from '@/features/feed/types'

export type SavedPostPreview = {
  /** What fills the square tile. */
  kind: 'image' | 'video' | 'document' | 'text'
  /** Signed URL for the image or video shown in the tile. */
  mediaUrl: string | null
  mediaAlt: string
  /** First lines of the post (or the reposted post when the repost has no words of its own). */
  text: string
  documentName: string | null
  mediaCount: number
  hasPoll: boolean
  isRepost: boolean
  authorName: string
}

const VIDEO_TYPES = new Set(['video/mp4', 'video/webm', 'video/quicktime'])

function orderedMedia(items: FeedMedia[] | undefined, single: FeedMedia | null): FeedMedia[] {
  const list = items?.length ? items : single ? [single] : []
  return list
    .filter((item) => Boolean(item.signedUrl))
    .sort((a, b) => Number(a.position ?? 0) - Number(b.position ?? 0))
}

/**
 * Works out what a saved post's grid tile shows: the first photo or video frame when there is one,
 * the document name for a PDF, otherwise the opening lines of text on a tinted tile.
 * A repost with no media of its own previews the original post it shares.
 */
export function savedPostPreview(post: FeedPost): SavedPostPreview {
  const source = post.postType === 'repost' && post.repostOf ? post.repostOf : null
  const ownMedia = orderedMedia(post.mediaItems, post.media)
  const media = ownMedia.length || !source ? ownMedia : orderedMedia(source.mediaItems, source.media)
  const first = media[0] ?? null
  const ownText = post.body.trim()
  const text = (ownText || source?.body.trim() || '').replace(/\s+/g, ' ')
  const poll = post.poll ?? source?.poll ?? null
  const authorName = post.author.fullName

  let kind: SavedPostPreview['kind'] = 'text'
  if (first?.mimeType.startsWith('image/')) kind = 'image'
  else if (first && VIDEO_TYPES.has(first.mimeType)) kind = 'video'
  else if (first?.mimeType === 'application/pdf') kind = 'document'

  return {
    kind,
    mediaUrl: kind === 'image' || kind === 'video' ? first?.signedUrl ?? null : null,
    mediaAlt: first?.altText?.trim() || `Photo from ${authorName}'s post`,
    text,
    documentName: kind === 'document' ? (first?.fileName || 'Document').replace(/\.pdf$/i, '') : null,
    mediaCount: media.length,
    hasPoll: Boolean(poll) || post.postType === 'poll',
    isRepost: post.postType === 'repost',
    authorName,
  }
}

/** Short accessible name for a tile, e.g. "Saved post by Capt. Rao: Bunkering checklist…". */
export function savedPostLabel(preview: SavedPostPreview) {
  const details = [
    preview.kind === 'video' ? 'video' : null,
    preview.kind === 'document' ? 'document' : null,
    preview.mediaCount > 1 ? `${preview.mediaCount} photos or videos` : null,
    preview.hasPoll ? 'poll' : null,
  ].filter(Boolean)
  const snippet = preview.text ? `: ${preview.text.length > 80 ? `${preview.text.slice(0, 77).trimEnd()}…` : preview.text}` : ''
  const extra = details.length ? ` (${details.join(', ')})` : ''
  return `Open saved post by ${preview.authorName}${extra}${snippet}`
}
