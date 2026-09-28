import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared shell for the public policy pages (Terms, Privacy, Contact, Refunds, Shipping):
 * one white card on the marketing background, an eyebrow, a title, the last-updated
 * date and plain sections.
 */
export function LegalPage({
  eyebrow,
  title,
  updated,
  intro,
  children,
}: {
  eyebrow: string
  title: string
  /** e.g. "28 September 2026" */
  updated?: string
  intro?: ReactNode
  children: ReactNode
}) {
  return (
    <main className="px-4 py-8 sm:px-6 sm:py-12">
      <article className="mx-auto max-w-3xl rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">{eyebrow}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950">{title}</h1>
        {updated ? <p className="mt-2 text-xs font-medium text-muted">Last updated: {updated}</p> : null}
        {intro ? <div className="mt-4 space-y-3 text-sm leading-7 text-muted">{intro}</div> : null}
        <div className="mt-6 space-y-7 text-sm leading-7 text-muted">{children}</div>
      </article>
    </main>
  )
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="scroll-mt-24">
      <h2 id={id} className="text-lg font-bold text-navy-950">{title}</h2>
      <div className="mt-2 space-y-3">{children}</div>
    </section>
  )
}

/** Bulleted list with the page's reading rhythm. */
export function LegalList({ children }: { children: ReactNode }) {
  return <ul className="list-disc space-y-2 pl-5 marker:text-ocean-700">{children}</ul>
}

/** Inline text link in the ocean-700 link style. */
export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  if (/^(mailto:|tel:|https?:)/.test(href)) {
    return <a href={href} className="font-semibold text-ocean-700 hover:underline">{children}</a>
  }
  return <Link href={href} className="font-semibold text-ocean-700 hover:underline">{children}</Link>
}

/** Row of related-policy links at the end of a policy page. */
export function RelatedPolicies({ links }: { links: Array<{ href: string; label: string }> }) {
  return (
    <nav aria-label="Related policies" className="border-t border-mist-100 pt-5">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">Related</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="inline-flex min-h-9 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-3 text-sm font-semibold text-navy-900 transition-colors hover:border-ocean-300 hover:bg-mist-50"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  )
}
