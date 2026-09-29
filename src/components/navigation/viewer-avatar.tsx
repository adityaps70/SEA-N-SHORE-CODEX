import { avatarPx, avatarSizes } from '@/lib/images/media-image-source'
import { MediaImage } from '@/components/ui/media-image'

export type HeaderViewer = {
  name: string
  avatarUrl?: string | null
  /** Shown in the phone side drawer header. */
  headline?: string | null
  organization?: string | null
  location?: string | null
  /** 0–100, the same score as the Home profile card; null when it could not be worked out. */
  profileCompletion?: number | null
}

export function viewerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}

export function ViewerAvatar({ viewer, className = 'size-8' }: { viewer: HeaderViewer; className?: string }) {
  const fallback = (
    <span
      aria-hidden="true"
      className={`${className} grid shrink-0 place-items-center rounded-full bg-navy-950 ${/(^|\s)text-(xs|sm|base|lg|xl)\b/.test(className) ? '' : 'text-[11px]'} font-bold text-white`}
    >
      {viewerInitials(viewer.name)}
    </span>
  )
  if (viewer.avatarUrl) {
    const px = avatarPx(className, 32)
    return (
      <MediaImage
        src={viewer.avatarUrl}
        alt=""
        width={px}
        height={px}
        sizes={avatarSizes(className, 32)}
        loading="eager"
        className={`${className} shrink-0 rounded-full object-cover`}
        fallback={fallback}
      />
    )
  }
  return fallback
}
