import Link from 'next/link'
import { BadgeCheck, MapPin, UserRound } from 'lucide-react'

export type JobCompanyIdentityProps = {
  name: string
  companyId: string | null
  companySlug: string | null
  logoPath: string | null | undefined
  location?: string | null
  companyType?: string | null
  verified?: boolean
  size?: 'sm' | 'md' | 'lg'
  /** Shown for personal-recruiter jobs, which have no organization page. */
  personalLabel?: string
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'SN'
}

const LOGO_SIZES = {
  sm: 'size-9 rounded-xl text-xs',
  md: 'size-12 rounded-2xl text-sm',
  lg: 'size-14 rounded-2xl text-base',
} as const

/** Organization logo with its initials fallback. Logos are served by the first-party logo route. */
export function JobCompanyLogo({
  name,
  companyId,
  logoPath,
  size = 'md',
}: Pick<JobCompanyIdentityProps, 'name' | 'companyId' | 'logoPath' | 'size'>) {
  const sizeClass = LOGO_SIZES[size]
  if (companyId && logoPath) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- authenticated company media is served through a first-party route
      <img
        src={`/api/company-logo/${companyId}`}
        alt={`${name} logo`}
        loading="lazy"
        className={`${sizeClass} shrink-0 border border-mist-100 bg-white object-contain p-1 shadow-sm`}
      />
    )
  }
  if (!companyId) {
    return (
      <div aria-hidden="true" className={`${sizeClass} grid shrink-0 place-items-center bg-mist-50 text-navy-900`}>
        <UserRound className={size === 'sm' ? 'size-4' : 'size-5'} />
      </div>
    )
  }
  return (
    <div aria-hidden="true" className={`${sizeClass} grid shrink-0 place-items-center bg-navy-950 font-black text-white shadow-sm`}>
      {initials(name)}
    </div>
  )
}

/** Who posted a job: organization logo, name (linked to its page), location and verification. */
export function JobCompanyIdentity({
  name,
  companyId,
  companySlug,
  logoPath,
  location = null,
  companyType = null,
  verified = false,
  size = 'md',
  personalLabel = 'Independent recruiter',
}: JobCompanyIdentityProps) {
  const details = [companyId ? companyType : personalLabel, location].filter((value): value is string => Boolean(value))
  return (
    <div className="flex min-w-0 items-center gap-3">
      <JobCompanyLogo name={name} companyId={companyId} logoPath={logoPath} size={size} />
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {companyId && companySlug ? (
            <Link href={`/organizations/${companySlug}`} className="truncate font-bold text-navy-950 hover:text-ocean-700 hover:underline">
              {name}
            </Link>
          ) : (
            <span className="truncate font-bold text-navy-950">{name}</span>
          )}
          {verified && companyId ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
              <BadgeCheck aria-hidden="true" className="size-3.5" />
              Verified
            </span>
          ) : null}
        </div>
        {details.length ? (
          <p className="mt-0.5 flex min-w-0 items-center gap-1 text-xs font-medium text-muted">
            {location ? <MapPin aria-hidden="true" className="size-3.5 shrink-0" /> : null}
            <span className="truncate">{details.join(' · ')}</span>
          </p>
        ) : null}
      </div>
    </div>
  )
}
