import type { Metadata } from 'next'
import { BRAND_ICONS } from '@/components/brand/brand-assets'
import type { FeedPost } from './types'

/**
 * Round F: share and search metadata for /posts/<id>. Posts are shareable but not indexed (the owner
 * decides on indexing later), so every variant carries noindex. Only "Anyone" posts describe their
 * content; everything else gets generic tags with nothing from the post.
 */

const NO_INDEX = { index: false, follow: false } as const

export function postPath(postId: string) {
  return `/posts/${postId}`
}

/** The first 150 characters of the post's text, on one line, cut at a word when it can be. */
export function postShareDescription(body: string, maxChars = 150) {
  const text = body.replace(/\s+/g, ' ').trim()
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars - 1)
  const boundary = cut.lastIndexOf(' ')
  return `${(boundary > maxChars * 0.6 ? cut.slice(0, boundary) : cut).trimEnd()}…`
}

function hasPhoto(post: FeedPost) {
  const items = post.mediaItems?.length ? post.mediaItems : post.media ? [post.media] : []
  const sourceItems = post.repostOf?.mediaItems ?? []
  return [...items, ...sourceItems].some((item) => item.mimeType?.startsWith('image/'))
}

export function publicPostMetadata(post: FeedPost): Metadata {
  const author = post.organization?.name ?? post.author.fullName
  const title = `${author} on Sea N Shore`
  const description = postShareDescription(post.body || post.repostOf?.body || '') || `A post by ${author} on Sea N Shore.`
  const url = postPath(post.id)
  const images = hasPhoto(post)
    ? [{ url: `/api/public/posts/${post.id}/image`, alt: `Photo from ${author}'s post` }]
    : [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }]
  return {
    title: { absolute: title },
    description,
    robots: NO_INDEX,
    alternates: { canonical: url },
    openGraph: { type: 'article', siteName: 'Sea N Shore', title, description, url, images },
    twitter: { card: 'summary_large_image', title, description, images: images.map((image) => image.url) },
  }
}

/** Members-only, signed in, or missing: nothing from the post. */
export function genericPostMetadata(title = 'Post'): Metadata {
  return {
    title,
    description: 'A post on Sea N Shore, the professional network for the maritime industry.',
    robots: NO_INDEX,
    openGraph: { type: 'website', siteName: 'Sea N Shore', title: `${title} | Sea N Shore`, images: [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }] },
  }
}
