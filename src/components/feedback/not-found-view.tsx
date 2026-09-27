import Link from 'next/link'
import { Anchor } from 'lucide-react'

export type NotFoundLink = { href: string; label: string }

export function NotFoundView({
  eyebrow = 'Page not found',
  title,
  body,
  primary,
  links = [],
  fullScreen = false,
  landmark = true,
  children,
}: {
  eyebrow?: string
  title: string
  body: string
  primary: NotFoundLink
  links?: NotFoundLink[]
  fullScreen?: boolean
  /** False when the surrounding layout already renders the page's <main> landmark. */
  landmark?: boolean
  children?: React.ReactNode
}) {
  const Root = landmark || fullScreen ? 'main' : 'div'
  const rootProps = Root === 'main' ? { id: 'main-content' } : {}
  return (
    <Root {...rootProps} className={`grid place-items-center ${Root === 'main' ? 'px-4' : ''} ${fullScreen ? 'min-h-screen bg-mist-50 py-10' : 'min-h-[55vh] py-8'}`}>
      <section className="w-full max-w-lg rounded-[1.75rem] border border-mist-100 bg-white p-7 text-center shadow-[var(--shadow-card)] sm:p-9">
        {children}
        <div className="mx-auto mt-2 grid size-14 place-items-center rounded-2xl bg-mist-50 text-ocean-700">
          <Anchor aria-hidden="true" className="size-6" />
        </div>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[.16em] text-ocean-700">{eyebrow}</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight text-navy-950 sm:text-3xl">{title}</h1>
        <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-muted">{body}</p>
        <div className="mt-7 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <Link href={primary.href} className="inline-flex min-h-11 items-center justify-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700">
            {primary.label}
          </Link>
          {links.map((link) => (
            <Link key={link.href} href={link.href} className="inline-flex min-h-11 items-center justify-center rounded-xl border border-mist-200 px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
              {link.label}
            </Link>
          ))}
        </div>
      </section>
    </Root>
  )
}
