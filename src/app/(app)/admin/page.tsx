import Link from 'next/link'
import { Building2, CheckCircle2, Clock3, KeyRound, ShieldAlert } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { adminRepository } from '@/features/admin/repository'

export default async function AdminPage() {
  const user = await requireAwsUser()
  const metrics = await adminRepository.getAdminDashboardMetrics(user.id)

  const cards = [
    { label: 'Pending organizations', value: metrics.pendingOrganizations, icon: Clock3 },
    { label: 'Changes requested', value: metrics.changesRequested, icon: Building2 },
    { label: 'Approved organizations', value: metrics.approvedOrganizations, icon: CheckCircle2 },
    { label: 'Suspended organizations', value: metrics.suspendedOrganizations, icon: ShieldAlert },
    { label: 'Pending access requests', value: metrics.pendingAccessRequests, icon: KeyRound },
  ] as const

  return (
    <main className="space-y-6">
      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {cards.map(({ label, value, icon: Icon }) => (
          <article key={label} className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-muted">{label}</p>
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-navy-950"><Icon aria-hidden="true" className="size-4" /></span>
            </div>
            <p className="mt-3 text-3xl font-bold tracking-tight text-navy-950">{value}</p>
          </article>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Organization verification</p>
          <h2 className="mt-2 text-2xl font-bold text-navy-950">Review employers before hiring access unlocks</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Pending organization applications are reviewed oldest-first. Approval verifies the employer and activates the founding owner membership in one controlled decision.</p>
          <Link href="/admin/organizations" className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
            Open organization queue
          </Link>
        </article>

        <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Access requests</p>
          <h2 className="mt-2 text-xl font-bold text-navy-950">Membership queue</h2>
          <p className="mt-2 text-sm leading-6 text-muted">{metrics.pendingAccessRequests} request{metrics.pendingAccessRequests === 1 ? '' : 's'} currently wait for review. Organization approval is live first; member-access review can be managed as the next admin workflow.</p>
        </article>
      </section>
    </main>
  )
}
