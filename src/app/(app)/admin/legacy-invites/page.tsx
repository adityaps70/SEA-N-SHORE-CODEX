import type { Metadata } from 'next'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { queueLegacyInviteBatch } from '@/features/legacy-invites/admin-actions'
import { legacyInviteRepository } from '@/features/legacy-invites/repository'

export const metadata: Metadata = { title: 'Legacy invites · Admin' }
export const dynamic = 'force-dynamic'

const statusClass: Record<string, string> = {
  queued: 'bg-amber-50 text-amber-800',
  sending: 'bg-sky-50 text-sky-800',
  sent: 'bg-emerald-50 text-emerald-800',
  failed: 'bg-red-50 text-red-800',
  skipped: 'bg-mist-100 text-muted',
}

export default async function LegacyInvitesAdminPage() {
  await requirePlatformAdministratorUser()
  const [metrics, recent] = await Promise.all([
    legacyInviteRepository.metrics(),
    legacyInviteRepository.recent(50),
  ])

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

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        {[
          ['Eligible', metrics.eligible],
          ['Queued', metrics.queued],
          ['Sending', metrics.sending],
          ['Sent', metrics.sent],
          ['Failed', metrics.failed],
          ['Skipped', metrics.skipped],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border border-mist-100 bg-white p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
            <p className="mt-1 text-2xl font-bold text-navy-950">{value}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border border-mist-100 bg-white p-5">
        <h2 className="text-lg font-bold text-navy-950">Queue a controlled batch</h2>
        <p className="mt-2 text-sm leading-6 text-muted">
          Queued invitations are picked up by the existing outbox worker in small batches. Start with 10 or 50,
          review delivery/bounce results in Resend, then increase gradually.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {[10, 50, 100].map((limit) => (
            <form key={limit} action={queueLegacyInviteBatch}>
              <input type="hidden" name="limit" value={limit} />
              <button
                type="submit"
                className="min-h-10 rounded-xl border border-ocean-200 bg-ocean-50 px-4 text-sm font-bold text-ocean-800 transition hover:bg-ocean-100"
              >
                Queue {limit}
              </button>
            </form>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">
          Queueing does not bypass identity verification. The email link only identifies the old registered email; the member must still verify ownership through the current Sea N Shore login flow.
        </p>
      </section>

      <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white">
        <div className="border-b border-mist-100 px-5 py-4">
          <h2 className="font-bold text-navy-950">Recent invitation queue</h2>
        </div>
        {recent.length === 0 ? (
          <p className="p-5 text-sm text-muted">No legacy invitations have been queued yet.</p>
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
                  <th className="px-4 py-3">Last error</th>
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
