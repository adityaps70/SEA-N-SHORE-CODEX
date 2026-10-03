import type { Metadata } from 'next'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { LegacyInviteControls } from '@/features/legacy-invites/controls'
import { LEGACY_INVITE_FROM, legacyInviteEmail } from '@/features/legacy-invites/email'
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

export default async function LegacyInvitesAdminPage() {
  await requirePlatformAdministratorUser()
  const [metrics, recent] = await Promise.all([
    legacyInviteRepository.metrics(),
    legacyInviteRepository.recent(50),
  ])
  const preview = legacyInviteEmail({
    fullName: 'Captain Example',
    claimToken: '11111111-1111-4111-8111-111111111111',
  })

  return (
    <main className="space-y-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.15em] text-ocean-700">Legacy account recovery</p>
        <h1 className="mt-1 text-2xl font-bold text-navy-950">Legacy user invitations</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          One-to-one account-reconnection notices sent through Resend. Legacy users are not added to the Newsletter list.
          Current verified accounts, already-claimed profiles and ambiguous duplicate emails are excluded automatically.
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ['Eligible', metrics.eligible],
          ['Prepared', metrics.prepared],
          ['Queued', metrics.queued],
          ['Sending', metrics.sending],
          ['Sent', metrics.sent],
          ['Failed', metrics.failed],
          ['Skipped', metrics.skipped],
          ['Cancelled', metrics.cancelled],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-mist-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-navy-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5">
        <h2 className="text-lg font-bold text-navy-950">Send controls</h2>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Preparing recipients is safe and does not send anything. Review the exact email below, then explicitly start sending.
          The worker handles at most 5 legacy invitations per sweep so the remaining queue can be stopped.
        </p>
        <div className="mt-5">
          <LegacyInviteControls
            prepared={metrics.prepared}
            queued={metrics.queued}
            failed={metrics.failed}
            sending={metrics.sending}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.12em] text-ocean-700">Exact outgoing format</p>
            <h2 className="mt-1 text-lg font-bold text-navy-950">Legacy invitation email preview</h2>
          </div>
          <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-muted">Account reconnection · Resend</span>
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-[90px_1fr]">
          <dt className="font-semibold text-muted">From</dt>
          <dd className="font-medium text-navy-950">{LEGACY_INVITE_FROM}</dd>
          <dt className="font-semibold text-muted">Subject</dt>
          <dd className="font-medium text-navy-950">{preview.subject}</dd>
          <dt className="font-semibold text-muted">CTA</dt>
          <dd className="font-medium text-navy-950">Reclaim my Sea N Shore profile</dd>
        </dl>

        <div className="mt-5 overflow-hidden rounded-2xl border border-mist-100 bg-mist-50">
          <iframe
            title="Legacy invitation email preview"
            srcDoc={preview.html}
            sandbox=""
            className="h-[650px] w-full bg-white"
          />
        </div>

        <details className="mt-4 rounded-xl border border-mist-100 bg-mist-50 p-4">
          <summary className="cursor-pointer text-sm font-bold text-navy-950">Show plain-text version</summary>
          <pre className="mt-3 whitespace-pre-wrap break-words text-xs leading-6 text-muted">{preview.text}</pre>
        </details>

        <p className="mt-3 text-xs leading-5 text-muted">
          The real email substitutes the member&apos;s name and a unique secure claim link. The claim link only pre-fills the legacy email; ownership must still be verified through Sea N Shore.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white">
        <div className="border-b border-mist-100 px-5 py-4">
          <h2 className="font-bold text-navy-950">Recent invitations</h2>
        </div>
        {recent.length === 0 ? (
          <p className="p-5 text-sm text-muted">No legacy invitations have been prepared yet.</p>
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
                {recent.map((invite) => (
                  <tr key={invite.id}>
                    <td className="px-4 py-3 font-semibold text-navy-950">{invite.fullName}</td>
                    <td className="px-4 py-3">{invite.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${statusClass[invite.status] ?? 'bg-mist-100 text-muted'}`}>
                        {invite.status}
                      </span>
                    </td>
                    <td className="px-4 py-3">{invite.attempts}</td>
                    <td className="px-4 py-3">{invite.sentAt ? new Date(invite.sentAt).toLocaleString('en-IN') : '—'}</td>
                    <td className="max-w-xs truncate px-4 py-3 text-muted" title={invite.lastError ?? undefined}>{invite.lastError ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  )
}
