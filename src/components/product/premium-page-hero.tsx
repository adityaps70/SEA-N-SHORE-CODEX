import type { ReactNode } from 'react'

type PremiumPageHeroProps = {
  eyebrow: string
  title: string
  description?: string
  eyebrowAccessory?: ReactNode
  children?: ReactNode
  className?: string
}

export function PremiumPageHero({
  eyebrow,
  title,
  description,
  eyebrowAccessory,
  children,
  className = '',
}: PremiumPageHeroProps) {
  return (
    // Compact section header: brand gradient kept, but about half the height of the
    // former hero so the page's real content starts above the fold on laptops and phones.
    <header className={`overflow-hidden rounded-2xl bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 px-5 py-4 text-white shadow-md sm:px-6 sm:py-5 ${className}`.trim()}>
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">{eyebrow}</p>
          {eyebrowAccessory}
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 hidden max-w-2xl text-sm leading-6 text-white/75 sm:line-clamp-2">{description}</p> : null}
      </div>
      {children}
    </header>
  )
}
