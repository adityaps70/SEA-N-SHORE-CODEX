import type { FeedMedia } from '../types'

export function PostMedia({
  media,
  authorName,
}: {
  media: FeedMedia
  authorName: string
}) {
  if (!media.signedUrl) return null

  const isVideo = media.mimeType === 'video/mp4' || media.mimeType === 'video/webm'

  if (isVideo) {
    return (
      <div className="mt-4 overflow-hidden rounded-2xl border border-mist-100 bg-black">
        <video
          controls
          preload="metadata"
          src={media.signedUrl}
          className="block max-h-[80vh] w-full bg-black"
          aria-label={media.altText ?? `Video attached to ${authorName}'s post`}
        >
          Your browser does not support this video.
        </video>
      </div>
    )
  }

  return (
    <div className="mt-4 flex justify-center overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
      {/* Signed post media is already access-controlled and should preserve its natural dimensions. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={media.signedUrl}
        alt={media.altText ?? `Image attached to ${authorName}'s post`}
        className="block h-auto max-h-[80vh] max-w-full object-contain"
      />
    </div>
  )
}
