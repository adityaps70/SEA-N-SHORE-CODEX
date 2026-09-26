import Link from 'next/link'
import { MailX, MailCheck, TriangleAlert } from 'lucide-react'
import { createNewsletterService, tokenMessages } from '../service'
import { newsletterTopicLabel } from '../topics'
import { NewsletterTokenAction } from './newsletter-token-action'

type Kind = 'confirm' | 'unsubscribe'

function Shell({ kind, children }: { kind: Kind; children: React.ReactNode }) {
  const Icon = kind === 'unsubscribe' ? MailX : MailCheck
  return (
    <main id="main-content" className="mx-auto grid w-full max-w-xl px-4 py-12 sm:px-6 sm:py-16">
      <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <span className="grid size-12 place-items-center rounded-2xl bg-ocean-50 text-ocean-700">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-5 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Newsletter</p>
        {children}
      </section>
    </main>
  )
}

function LinkProblem({ kind, message }: { kind: Kind; message: string }) {
  return (
    <Shell kind={kind}>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">
        {kind === 'unsubscribe' ? 'We could not use this unsubscribe link' : 'We could not use this confirmation link'}
      </h1>
      <p role="alert" className="mt-3 flex items-start gap-2 text-sm leading-6 text-muted">
        <TriangleAlert aria-hidden="true" className="mt-1 size-4 shrink-0 text-red-700" />
        <span>{message}</span>
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Link href="/newsletter" className="inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700">
          Go to the newsletter page
        </Link>
        <Link href="/help" className="inline-flex min-h-11 items-center rounded-xl border border-mist-200 px-5 text-sm font-semibold text-navy-950 hover:bg-mist-50">
          Contact & support
        </Link>
      </div>
    </Shell>
  )
}

/**
 * Landing page for signed newsletter links. Nothing changes on page load (mail
 * scanners open links automatically); the person confirms with one button.
 */
export async function NewsletterLinkPage({ kind, token }: { kind: Kind; token: string | null }) {
  if (!token) return <LinkProblem kind={kind} message={tokenMessages.invalid} />

  let inspected: Awaited<ReturnType<ReturnType<typeof createNewsletterService>['inspectToken']>>
  try {
    inspected = await createNewsletterService().inspectToken(token, kind)
  } catch {
    return <LinkProblem kind={kind} message="We could not check this link just now. Please open it again in a minute." />
  }
  if (!inspected.ok) return <LinkProblem kind={kind} message={inspected.message} />

  const { subscriber } = inspected
  const topics = subscriber.topics.map(newsletterTopicLabel).join(', ')

  if (kind === 'unsubscribe') {
    return (
      <Shell kind={kind}>
        <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">
          {subscriber.status === 'unsubscribed' ? 'You are already unsubscribed' : 'Unsubscribe from the Sea N Shore newsletter?'}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          {subscriber.status === 'unsubscribed'
            ? `${subscriber.email} does not receive Sea N Shore newsletters.`
            : `${subscriber.email} will stop receiving all Sea N Shore newsletters${topics ? ` (${topics})` : ''}. You can subscribe again at any time.`}
        </p>
        {subscriber.status !== 'unsubscribed' ? (
          <div className="mt-6"><NewsletterTokenAction kind="unsubscribe" token={token} /></div>
        ) : (
          <p className="mt-6 text-sm"><Link href="/newsletter" className="font-semibold text-ocean-700 hover:text-navy-950">Subscribe again</Link></p>
        )}
      </Shell>
    )
  }

  return (
    <Shell kind={kind}>
      <h1 className="mt-2 text-2xl font-bold tracking-tight text-navy-950">
        {subscriber.status === 'subscribed' ? 'Your subscription is already confirmed' : 'Confirm your newsletter subscription'}
      </h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        {subscriber.status === 'subscribed'
          ? `${subscriber.email} already receives ${topics}.`
          : subscriber.status === 'unsubscribed'
            ? `${subscriber.email} unsubscribed after this link was sent, so it cannot be used. Sign up again on the newsletter page if you want to rejoin.`
            : `Confirm that ${subscriber.email} should receive: ${topics}.`}
      </p>
      {subscriber.status === 'pending' ? (
        <div className="mt-6"><NewsletterTokenAction kind="confirm" token={token} /></div>
      ) : (
        <p className="mt-6 text-sm"><Link href="/newsletter" className="font-semibold text-ocean-700 hover:text-navy-950">Go to the newsletter page</Link></p>
      )}
    </Shell>
  )
}
