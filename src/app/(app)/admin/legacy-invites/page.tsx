import type { Metadata } from 'next'
import Link from 'next/link'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { emailDeliveryRepository } from '@/features/email-delivery/repository'
import { LegacyInviteControls, LegacyReminderTestButton } from '@/features/legacy-invites/controls'
import { LEGACY_INVITE_FROM, legacyInviteEmail } from '@/features/legacy-invites/email'
import { legacyReminderEmail } from '@/features/legacy-invites/reminder-email'
import { legacyReminderRepository, REMINDER_EXCLUSIONS } from '@/features/legacy-invites/reminder-repository'
import { legacyInviteRepository } from '@/features/legacy-invites/repository'

export const metadata: Metadata = { title: 'Legacy invites · Admin' }
export const dynamic = 'force-dynamic'

const statusClass: Record<string, string> = {
  prepared: 'bg-violet-50 text-violet-800',
  queued: 'bg-amber-50 text-amber-800',
  sending: 'bg-sky-50 text-sky-800',
  sent: 'bg-emerald-50 text-emerald-800',
  failed: 'bg-red-50 text-red-800',
  skipped: 'bg-mist-100 text-muted',
  cancelled: 'bg-mist-100 text-muted',
}

const SAMPLE = {
  fullName: 'Captain Example',
  email: 'captain@example.com',
  claimToken: '11111111-1111-4111-8111-111111111111',
  unsubscribeToken: '22222222-2222-4222-8222-222222222222',
}

function when(value: string | null) {
  return value ? new Date(value).toLocaleString('en-IN') : '—'
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-white p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold text-navy-950">{value}</p>
    </div>
  )
}

function Preview(props: { title: string; subject: string; preheader?: string; html: string; text: string; extra?: Array<[string, string]>; tall?: boolean }) {
  return (
    <section className="rounded-2xl border border-mist-100 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-ocean-700">Exact outgoing format</p>
          <h2 className="mt-1 text-lg font-bold text-navy-950">{props.title}</h2>
        </div>
        <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-muted">Account reconnection · Resend</span>
      </div>

      <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[150px_1fr]">
        <dt className="font-semibold text-muted">From</dt>
        <dd className="font-medium text-navy-950">{LEGACY_INVITE_FROM}</dd>
        <dt className="font-semibold text-muted">Subject</dt>
        <dd className="font-medium text-navy-950">{props.subject}</dd>
        {props.preheader ? (
          <>
            <dt className="font-semibold text-muted">Preheader</dt>
            <dd className="font-medium text-navy-950">{props.preheader}</dd>
          </>
        ) : null}
        <dt className="font-semibold text-muted">CTA</dt>
        <dd className="font-medium text-navy-950">Reclaim my Sea N Shore profile</dd>
        {props.extra?.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="font-semibold text-muted">{label}</dt>
            <dd className="break-all font-mono text-xs text-navy-950">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
        <iframe title={`${props.title} preview`} srcDoc={props.html} sandbox="" className={`${props.tall ? 'h-[1080px]' : 'h-[650px]'} w-full bg-white`} />
      </div>

      <details className="mt-4 rounded-xl border border-mist-100 bg-mist-50 p-4">
        <summary className="cursor-pointer text-sm font-bold text-navy-950">Show plain-text version</summary>
        <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-muted">{props.text}</pre>
      </details>

      <p className="mt-3 text-xs leading-5 text-muted">
        The real email substitutes the member&apos;s name and a unique secure claim link. The claim link only pre-fills the legacy email; ownership must still be verified through Sea N Shore.
      </p>
    </section>
  )
}

function RecentTable(props: {
  title: string
  empty: string
  rows: Array<{ id: string; fullName: string; email: string; status: string; attempts: number; sentAt: string | null; lastEvent: string | null; lastEventAt: string | null; lastError: string | null }>
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white">
      <div className="border-b border-mist-100 px-5 py-4">
        <h2 className="font-bold text-navy-950">{props.title}</h2>
      </div>
      {props.rows.length === 0 ? (
        <p className="p-5 text-sm text-muted">{props.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-mist-50 text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Attempts</th>
                <th className="px-4 py-3">Sent</th>
                <th className="px-4 py-3">Last event</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-100">
              {props.rows.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3 font-semibold text-navy-950">{row.fullName}</td>
                  <td className="px-4 py-3">{row.email}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass[row.status] ?? 'bg-mist-100 text-muted'}`} title={row.lastError ?? undefined}>
                      {row.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">{row.attempts}</td>
                  <td className="px-4 py-3">{when(row.sentAt)}</td>
                  <td className="max-w-xs px-4 py-3 text-muted">
                    {row.lastEvent ? (
                      <span title={row.lastEventAt ? when(row.lastEventAt) : undefined}>
                        <span className="font-semibold text-navy-950">{row.lastEvent.replace('_', ' ')}</span>
                        {row.lastEventAt ? <span className="block text-xs">{when(row.lastEventAt)}</span> : null}
                      </span>
                    ) : (
                      <span className="block truncate" title={row.lastError ?? undefined}>{row.lastError ?? '—'}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export default async function LegacyInvitesAdminPage({ searchParams }: { searchParams?: Promise<{ mode?: string | string[] }> }) {
  await requirePlatformAdministratorUser()
  const params = (await searchParams) ?? {}
  const mode = params.mode === 'reminder' ? 'reminder' : 'invite'

  const tabs = (
    <nav aria-label="Legacy invitation mode" className="flex flex-wrap gap-2">
      {([['invite', 'First invitation', '/admin/legacy-invites'], ['reminder', 'Second reminder', '/admin/legacy-invites?mode=reminder']] as const).map(([key, label, href]) => (
        <Link
          key={key}
          href={href}
          aria-current={mode === key ? 'page' : undefined}
          className={mode === key
            ? 'inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white'
            : 'inline-flex min-h-10 items-center rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-900 hover:bg-mist-50'}
        >
          {label}
        </Link>
      ))}
    </nav>
  )

  const header = (
    <header>
      <p className="text-xs font-bold uppercase tracking-[0.15em] text-ocean-700">Legacy account recovery</p>
      <h1 className="mt-1 text-2xl font-bold text-navy-950">Legacy user invitations</h1>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        One-to-one account-reconnection notices sent through Resend. Legacy users are not added to the Newsletter list.
        Current verified accounts, already-claimed profiles, ambiguous duplicate emails and do-not-email addresses are excluded automatically.
      </p>
    </header>
  )

  if (mode === 'reminder') {
    const [breakdown, metrics, recent] = await Promise.all([
      legacyReminderRepository.breakdown(),
      legacyReminderRepository.metrics(),
      legacyReminderRepository.recent(50),
    ])
    const preview = legacyReminderEmail({ ...SAMPLE })

    return (
      <div className="space-y-5">
        {header}
        {tabs}

        <section className="rounded-2xl border border-mist-100 bg-white p-5">
          <h2 className="text-lg font-bold text-navy-950">Who gets a second reminder</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Only people whose first invitation was sent at least 7 days ago and delivered, with no bounce, complaint or suppression,
            whose profile is not claimed, who have no Sea N Shore account with that email (any letter case) and who have not opted out.
            One reminder per person, ever. Every rule is checked again just before each reminder is sent.
          </p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Eligible now" value={breakdown.eligible} />
            <Metric label="First invitations" value={breakdown.total} />
          </div>
          <h3 className="mt-5 text-sm font-bold text-navy-950">Excluded, by reason</h3>
          <p className="mt-1 text-xs leading-5 text-muted">Each first invitation is counted once, under the first rule it fails in this order, so the rows add up.</p>
          <table className="mt-3 w-full max-w-xl text-left text-sm">
            <tbody className="divide-y divide-mist-100">
              {REMINDER_EXCLUSIONS.map(([key, label]) => (
                <tr key={key}>
                  <td className="py-2 pr-4 text-navy-950">{label}</td>
                  <td className="py-2 text-right font-bold tabular-nums text-navy-950">{breakdown.excluded[key]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="Prepared" value={metrics.prepared} />
          <Metric label="Queued" value={metrics.queued} />
          <Metric label="Sending" value={metrics.sending} />
          <Metric label="Sent" value={metrics.sent} />
          <Metric label="Failed" value={metrics.failed} />
          <Metric label="Skipped" value={metrics.skipped} />
          <Metric label="Cancelled" value={metrics.cancelled} />
        </section>

        <section className="rounded-2xl border border-mist-100 bg-white p-5">
          <h2 className="text-lg font-bold text-navy-950">Send controls</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            Preparing recipients is safe and does not send anything. Review the exact email below, then explicitly start sending.
            The worker handles at most 5 reminders per sweep so the remaining queue can be stopped. A failed reminder is not retried.
          </p>
          <div className="mt-5">
            <LegacyInviteControls mode="reminder" prepared={metrics.prepared} queued={metrics.queued} failed={metrics.failed} sending={metrics.sending} />
          </div>
        </section>

        <section className="rounded-2xl border border-mist-100 bg-white p-5">
          <h2 className="text-lg font-bold text-navy-950">Send yourself a test</h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            A test is not a reminder: it does not change eligibility or the queue. Its links open a page that says it is a test, and its unsubscribe link changes nothing.
          </p>
          <div className="mt-3"><LegacyReminderTestButton /></div>
        </section>

        <Preview
          title="Second reminder email preview"
          subject={preview.subject}
          preheader={preview.preheader}
          html={preview.html}
          text={preview.text}
          extra={preview.headers.map((header) => [header.Name, header.Value])}
          tall
        />

        <RecentTable title="Recent reminders" empty="No reminders have been prepared yet." rows={recent} />
      </div>
    )
  }

  const [metrics, recent, backfill] = await Promise.all([
    legacyInviteRepository.metrics(),
    legacyInviteRepository.recent(50),
    emailDeliveryRepository.backfillProgress(),
  ])
  const preview = legacyInviteEmail({ fullName: SAMPLE.fullName, claimToken: SAMPLE.claimToken })

  return (
    <div className="space-y-5">
      {header}
      {tabs}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Eligible" value={metrics.eligible} />
        <Metric label="Prepared" value={metrics.prepared} />
        <Metric label="Queued" value={metrics.queued} />
        <Metric label="Sending" value={metrics.sending} />
        <Metric label="Sent" value={metrics.sent} />
        <Metric label="Failed" value={metrics.failed} />
        <Metric label="Skipped" value={metrics.skipped} />
        <Metric label="Cancelled" value={metrics.cancelled} />
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5">
        <h2 className="text-lg font-bold text-navy-950">Delivery status</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          New delivery events arrive from Resend&apos;s signed webhook. For invitations sent before it existed, the worker fetches each
          email&apos;s final status from Resend once (about 20 every 20 seconds): {backfill.checked} of {backfill.total} checked
          {backfill.remaining > 0 ? `, ${backfill.remaining} to go` : ''}.
        </p>
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5">
        <h2 className="text-lg font-bold text-navy-950">Send controls</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Preparing recipients is safe and does not send anything. Review the exact email below, then explicitly start sending.
          The worker handles at most 5 legacy invitations per sweep so the remaining queue can be stopped.
        </p>
        <div className="mt-5">
          <LegacyInviteControls prepared={metrics.prepared} queued={metrics.queued} failed={metrics.failed} sending={metrics.sending} />
        </div>
      </section>

      <Preview title="Legacy invitation email preview" subject={preview.subject} html={preview.html} text={preview.text} />

      <RecentTable title="Recent invitations" empty="No legacy invitations have been prepared yet." rows={recent} />
    </div>
  )
}
