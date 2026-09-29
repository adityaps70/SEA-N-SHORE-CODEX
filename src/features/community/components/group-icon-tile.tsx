import { GroupIcon } from '../group-icons'

const sizes = {
  sm: 'size-10 rounded-lg [&>svg]:size-5',
  md: 'size-12 rounded-xl [&>svg]:size-6',
  xl: 'size-20 rounded-2xl border-4 border-white shadow-sm [&>svg]:size-9 sm:size-24 sm:[&>svg]:size-11',
} as const

/** Navy tile with the group's lucide icon (UsersRound when none is stored). */
export function GroupIconTile({ icon, size = 'md', className = '' }: { icon: string | null; size?: keyof typeof sizes; className?: string }) {
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center bg-navy-950 text-white ${sizes[size]} ${className}`}>
      <GroupIcon icon={icon} />
    </span>
  )
}

/** Wide cover image, or the Sea N Shore navy-to-ocean gradient when none is uploaded. */
export function GroupCover({ coverUrl, name, className = 'h-32 sm:h-44' }: { coverUrl: string | null; name: string; className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_70%,var(--teal-500))] ${className}`}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private media streamed through the feed media route
        <img src={coverUrl} alt={`${name} cover image`} className="size-full object-cover" loading="lazy" />
      ) : null}
    </div>
  )
}
