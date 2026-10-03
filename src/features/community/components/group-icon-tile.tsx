import { MediaImage } from '@/components/ui/media-image'
import { GroupIcon } from '../group-icons'

const sizes = {
  sm: { tile: 'size-10 rounded-lg', icon: 'size-5', sizes: '40px' },
  md: { tile: 'size-12 rounded-xl', icon: 'size-6', sizes: '48px' },
  xl: { tile: 'size-20 rounded-2xl border-4 border-white shadow-sm sm:size-24', icon: 'size-9 sm:size-11', sizes: '96px' },
} as const

/**
 * The community photo (round 9C, a rounded square) when one is uploaded, otherwise the navy tile
 * with the group's lucide icon (UsersRound when none is stored). The icon stays underneath the
 * photo until it has painted, and is all that remains if the photo fails to load.
 */
export function GroupIconTile({
  icon,
  iconUrl = null,
  size = 'md',
  className = '',
}: {
  icon: string | null
  iconUrl?: string | null
  size?: keyof typeof sizes
  className?: string
}) {
  const variant = sizes[size]
  return (
    <span
      aria-hidden="true"
      data-testid="group-icon-tile"
      className={`relative grid shrink-0 place-items-center overflow-hidden bg-navy-950 text-white ${variant.tile} ${className}`}
    >
      {iconUrl ? (
        <MediaImage src={iconUrl} alt="" fill sizes={variant.sizes} className="object-cover" fallback={<GroupIcon icon={icon} className={variant.icon} />} />
      ) : (
        <GroupIcon icon={icon} className={variant.icon} />
      )}
    </span>
  )
}

/** Wide banner image, or the Sea N Shore navy-to-ocean gradient when none is uploaded. */
export function GroupCover({ coverUrl, name, className = 'h-32 sm:h-44' }: { coverUrl: string | null; name: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_70%,var(--teal-500))] ${className}`}>
      {coverUrl ? (
        <MediaImage src={coverUrl} alt={`${name} cover image`} fill sizes="(min-width: 896px) 896px, 100vw" className="object-cover" />
      ) : null}
    </div>
  )
}
