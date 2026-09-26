export type HeaderViewer = {
  name: string
  avatarUrl?: string | null
}

export function viewerInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[parts.length - 1][0]}` : (parts[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}

export function ViewerAvatar({ viewer, className = 'size-8' }: { viewer: HeaderViewer; className?: string }) {
  if (viewer.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatar URLs are short-lived signed S3 links
      <img
        src={viewer.avatarUrl}
        alt=""
        className={`${className} shrink-0 rounded-full object-cover`}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className={`${className} grid shrink-0 place-items-center rounded-full bg-navy-950 text-[11px] font-bold text-white`}
    >
      {viewerInitials(viewer.name)}
    </span>
  )
}
