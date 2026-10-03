import Image from 'next/image'
import { organizationInitials, organizationLogoUrl } from '../organization-page-profile'

const sizes = {
  xs: { box: 'size-8 rounded-md text-[10px]', pixels: 32 },
  sm: { box: 'size-10 rounded-lg text-xs', pixels: 40 },
  md: { box: 'size-14 rounded-xl text-sm', pixels: 56 },
  lg: { box: 'size-16 rounded-xl text-base border-2 border-white shadow-sm', pixels: 64 },
  xl: { box: 'size-20 rounded-2xl text-xl border-4 border-white shadow-sm sm:size-28 sm:text-2xl', pixels: 112 },
} as const

/** Organization logo from private storage, or its initials on navy. */
export function OrganizationLogo({
  company,
  size = 'md',
  className = '',
}: {
  company: { id: string; name: string; logoPath: string | null }
  size?: keyof typeof sizes
  className?: string
}) {
  const config = sizes[size]
  const src = organizationLogoUrl(company)
  return (
    <span className={`grid shrink-0 place-items-center overflow-hidden bg-navy-950 font-bold text-white ${config.box} ${className}`}>
      {src ? (
        <Image
          src={src}
          alt={`${company.name} logo`}
          width={config.pixels}
          height={config.pixels}
          unoptimized
          className="size-full bg-white object-contain"
        />
      ) : (
        <span aria-hidden="true">{organizationInitials(company.name)}</span>
      )}
    </span>
  )
}

/** Wide cover image, or the Sea N Shore gradient when none is uploaded. */
export function OrganizationCover({
  coverUrl,
  name,
  className = 'h-32 sm:h-44',
}: {
  coverUrl: string | null
  name: string
  className?: string
}) {
  return (
    <div className={`relative overflow-hidden bg-[linear-gradient(115deg,var(--navy-950),var(--ocean-700)_58%,var(--teal-500))] ${className}`}>
      {coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- private media streamed through /api/company-cover
        <img src={coverUrl} alt={`${name} cover image`} className="size-full object-cover" loading="lazy" />
      ) : null}
    </div>
  )
}
