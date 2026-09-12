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
    <header className={`overflow-hidden rounded-[2rem] bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-6 text-white shadow-xl sm:p-8 ${className}`.trim()}>
      <div className="max-w-3xl">
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">{eyebrow}</p>
          {eyebrowAccessory}
        </div>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
        {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">{description}</p> : null}
      </div>
      {children}
    </header>
  )
}
