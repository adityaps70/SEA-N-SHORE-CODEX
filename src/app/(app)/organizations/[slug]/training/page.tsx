import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Award, Download, FileText, GraduationCap, ShieldCheck, Ticket, UsersRound } from 'lucide-react'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { BuySeatsForm } from '@/features/learning/company-training/components/buy-seats-form'
import {
  AssignSeatsForm,
  CancelInvitationButton,
  CrewMemberControls,
  InviteCrewForm,
  ReassignSeatControl,
  SeatRefundControl,
} from '@/features/learning/company-training/components/training-controls'
import { crewRepository } from '@/features/learning/company-training/crew-repository'
import { CERTIFICATE_EXPIRY_WINDOW_DAYS, trainingDashboardRepository, type AssignedSeat, type GroupProgress } from '@/features/learning/company-training/dashboard-repository'
import { SEAT_REASSIGN_MAX_PROGRESS, SEAT_REFUND_DAYS, SEAT_VALIDITY_MONTHS, volumeDiscountLabel } from '@/features/learning/company-training/seat-rules'
import { trainingRepository } from '@/features/learning/company-training/training-repository'
import { accessPeriodLabel, planPriceLabel } from '@/features/learning/course-plans'
import { OrganizationManageShell } from '@/features/organizations/components/organization-manage-shell'
import { canRunCompanyTraining, loadManageShellContext } from '@/features/organizations/manage-context'
import { organizationWorkspaceRepository } from '@/features/organizations/workspace-repository'
import { formatMoney } from '@/features/payments/currency'
import { getPaymentCapabilities } from '@/features/payments/provider'

export const metadata: Metadata = { title: 'Crew training' }

type View = 'overview' | 'seats' | 'crew'
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'seats', label: 'Seats' },
  { id: 'crew', label: 'Crew' },
]

function viewFrom(value: string | string[] | undefined): View {
  const raw = Array.isArray(value) ? value[0] : value
  return raw === 'seats' || raw === 'crew' ? raw : 'overview'
}

function date(value: string | null) {
  return value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : null
}

const card = 'rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5'

function StatTile({ icon: Icon, label, value, detail }: { icon: typeof Ticket; label: string; value: number; detail?: string | null }) {
  return (
    <li className="rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] max-md:rounded-xl max-md:p-3">
      <Icon aria-hidden="true" className="size-5 text-ocean-700 max-md:size-4" />
      <p className="mt-3 text-3xl font-bold text-navy-950 max-md:mt-2 max-md:text-2xl">{value}</p>
      <p className="mt-0.5 text-sm font-semibold text-muted max-md:text-xs">{label}</p>
      {detail ? <p className="mt-0.5 text-xs text-muted">{detail}</p> : null}
    </li>
  )
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-2 w-24 overflow-hidden rounded-full bg-mist-100" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <span className="block h-full rounded-full bg-teal-600" style={{ width: `${percent}%` }} />
      </span>
      <span className="text-sm font-semibold tabular-nums text-navy-950">{percent}%</span>
    </span>
  )
}

function StateChip({ seat }: { seat: AssignedSeat }) {
  if (!seat.progress) {
    return <span className="rounded-full bg-mist-100 px-2.5 py-0.5 text-xs font-bold text-navy-900">{seat.sharing === 'withdrawn' ? 'Stopped sharing' : 'Left the crew'}</span>
  }
  const style = seat.progress.state === 'completed' ? 'bg-emerald-50 text-emerald-800' : seat.progress.state === 'in_progress' ? 'bg-sky-50 text-sky-900' : 'bg-amber-50 text-amber-900'
  const label = seat.progress.state === 'completed' ? 'Completed' : seat.progress.state === 'in_progress' ? 'In progress' : 'Not started'
  return <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${style}`}>{label}</span>
}

function GroupTable({ title, rows }: { title: string; rows: GroupProgress[] }) {
  return (
    <section aria-labelledby={`${title}-heading`} className={card}>
      <h2 id={`${title}-heading`} className="text-base font-bold text-navy-950">{title}</h2>
      {rows.length ? (
        <ul className="mt-3 divide-y divide-mist-100">
          {rows.map((row) => {
            const percent = row.assigned ? Math.round((row.completed / row.assigned) * 100) : 0
            return (
              <li key={row.label} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                <span className="min-w-0 font-semibold text-navy-950">{row.label}</span>
                <span className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
                  <span>{row.assigned} assigned</span>
                  <span>{row.inProgress} in progress</span>
                  <span>{row.notStarted} not started</span>
                  <ProgressBar percent={percent} label={`${row.label}: ${percent}% completed`} />
                </span>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="mt-2 text-sm text-muted">Progress appears here once crew members start their assigned courses.</p>
      )}
    </section>
  )
}

/**
 * D3: a company's crew training. Overview (progress by vessel and rank, every assigned seat, CSV), Seats (buy seat
 * packs, refunds, invoices) and Crew (invitations, tags, assigning seats). For the owner, administrators and learning
 * managers; platform admins see it read only. Progress is shown only for members who share it, and only for the
 * courses the company assigned them.
 */
export default async function CompanyTrainingPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams?: Promise<{ view?: string | string[] }> }) {
  const { slug } = await params
  const view = viewFrom((await searchParams)?.view)
  const user = await requireAwsUser()
  const workspace = await organizationWorkspaceRepository.getBySlug(slug)
  if (!workspace) notFound()
  const access = await getAccessContext(user.id)
  const canManage = canRunCompanyTraining(access, workspace.id)
  const platformAdmin = canManage ? false : await canUsePlatformAdminAuthority(user.id)
  if (!canManage && !platformAdmin) notFound()
  const actor = { actorId: user.id, platformAdmin }
  const writable = canManage && workspace.verified
  const blocked = !workspace.verified ? 'Crew training opens once Sea N Shore has verified this organization.' : !canManage ? 'You are viewing this as the Sea N Shore team, so it is read only.' : null

  const [shell, dashboard, packs, summary, buyable, crew, assignOptions, payments] = await Promise.all([
    loadManageShellContext(user.id, workspace.id, access),
    view === 'overview' ? trainingDashboardRepository.dashboard(actor, workspace.id) : null,
    view === 'seats' ? trainingRepository.seatPacks(actor, workspace.id) : null,
    view === 'seats' ? trainingRepository.seatSummary(actor, workspace.id) : null,
    view === 'seats' && writable ? trainingRepository.buyableCourses(actor, workspace.id) : null,
    view === 'crew' ? crewRepository.list(actor, workspace.id) : null,
    view === 'crew' || view === 'overview' ? trainingRepository.assignOptions(actor, workspace.id) : null,
    view === 'seats' && writable ? getPaymentCapabilities() : null,
  ])
  const crewNames = assignOptions?.flatMap((course) => course.eligible.map((person) => ({ ...person, courseId: course.courseId }))) ?? []
  const now = new Date().getTime()

  return (
    <OrganizationManageShell workspace={workspace} active="training" {...shell} showTraining>
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700 max-md:hidden">Learning</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 max-md:sr-only">Crew training</h1>
        <p className="mt-1 max-w-3xl text-sm leading-6 text-muted max-md:mt-0 max-md:text-[13px] max-md:leading-5">
          Buy course seats for your crew, invite them, and follow their progress. Crew members choose to share their progress and certificates for the courses you assign them, and nothing else.
        </p>
      </div>

      <nav aria-label="Crew training sections" className="-mx-1 flex gap-1 overflow-x-auto px-1 [scrollbar-width:none]">
        {VIEWS.map((item) => (
          <Link
            key={item.id}
            href={`/organizations/${workspace.slug}/training${item.id === 'overview' ? '' : `?view=${item.id}`}`}
            aria-current={item.id === view ? 'page' : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-full px-4 text-sm font-bold transition ${item.id === view ? 'bg-navy-950 text-white' : 'border border-mist-200 bg-white text-navy-950 hover:border-ocean-300 hover:bg-ocean-50'}`}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {blocked ? <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-950">{blocked}</p> : null}

      {dashboard ? (
        <>
          <ul className="grid gap-3 max-md:grid-cols-2 max-md:gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <StatTile icon={Ticket} label="Seats to assign" value={dashboard.totals.seatsAvailable} detail={`${dashboard.totals.seatsBought} bought${dashboard.totals.seatsExpired ? ` · ${dashboard.totals.seatsExpired} expired` : ''}`} />
            <StatTile icon={UsersRound} label="Seats in use" value={dashboard.totals.seatsAssigned} detail={`${dashboard.totals.crewActive} in crew · ${dashboard.totals.invitationsPending} invited`} />
            <StatTile icon={GraduationCap} label="Completed" value={dashboard.totals.completed} detail={`${dashboard.totals.inProgress} in progress · ${dashboard.totals.notStarted} not started`} />
            <StatTile icon={Award} label="Certificates expiring" value={dashboard.totals.certificatesExpiringSoon} detail={`In the next ${CERTIFICATE_EXPIRY_WINDOW_DAYS} days`} />
          </ul>

          <div className="grid gap-4 lg:grid-cols-2">
            <GroupTable title="By vessel" rows={dashboard.byVessel} />
            <GroupTable title="By rank" rows={dashboard.byRank} />
          </div>

          <section aria-labelledby="learners-heading" className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="learners-heading" className="text-base font-bold text-navy-950">Assigned seats</h2>
                <p className="mt-0.5 text-sm text-muted">A seat can move to someone else while its learner is at {SEAT_REASSIGN_MAX_PROGRESS}% or less.</p>
              </div>
              {dashboard.seats.length ? (
                <a href={`/api/organizations/${workspace.id}/training/export`} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50">
                  <Download aria-hidden="true" className="size-4" /> Download CSV
                </a>
              ) : null}
            </div>
            {dashboard.seats.length ? (
              <ul className="mt-3 divide-y divide-mist-100">
                {dashboard.seats.map((seat) => {
                  const options = crewNames.filter((person) => person.courseId === seat.courseId && person.profileId !== seat.learner.profileId)
                  return (
                    <li key={seat.seatId} className="grid gap-2 py-3 md:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_24rem] md:items-center md:gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-navy-950">{seat.learner.name}</p>
                        <p className="truncate text-xs text-muted">{[seat.learner.rank, seat.learner.vessel].filter(Boolean).join(' · ') || 'No vessel or rank set'}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-navy-900">{seat.courseTitle}</p>
                        <p className="text-xs text-muted">
                          Assigned {date(seat.assignedAt)}
                          {seat.progress?.certificate ? ` · Certificate ${seat.progress.certificate.number}${seat.progress.certificate.expiresAt ? `, expires ${date(seat.progress.certificate.expiresAt)}` : ''}` : ''}
                          {seat.progress?.completedAt ? ` · Completed ${date(seat.progress.completedAt)}` : ''}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 md:flex-nowrap md:justify-end">
                        {seat.progress ? <ProgressBar percent={seat.progress.percent} label={`${seat.learner.name}: ${seat.progress.percent}% of ${seat.courseTitle}`} /> : null}
                        <StateChip seat={seat} />
                        {writable && seat.canReassign ? <ReassignSeatControl companyId={workspace.id} seatId={seat.seatId} learnerName={seat.learner.name} options={options} /> : null}
                      </div>
                    </li>
                  )
                })}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted">
                No seats are in use yet. {writable ? <Link href={`/organizations/${workspace.slug}/training?view=crew`} className="font-semibold text-ocean-700 hover:underline">Invite your crew and assign seats</Link> : null}
              </p>
            )}
          </section>
        </>
      ) : null}

      {packs && summary ? (
        <>
          {buyable ? (
            <section aria-labelledby="buy-heading" className={card}>
              <h2 id="buy-heading" className="text-base font-bold text-navy-950">Buy seats</h2>
              <p className="mt-0.5 mb-4 text-sm text-muted">
                One business GST invoice per pack. Seats can be assigned for {SEAT_VALIDITY_MONTHS} months; unassigned seats can be refunded within {SEAT_REFUND_DAYS} days.
              </p>
              <BuySeatsForm
                companyId={workspace.id}
                companyName={workspace.name}
                paymentsConfigured={payments?.configured ?? false}
                courses={buyable.map((course) => ({
                  id: course.id,
                  title: course.title,
                  plans: course.plans.map((plan) => ({ id: plan.id, name: plan.name, priceLabel: planPriceLabel(plan), accessLabel: accessPeriodLabel(plan.accessMonths) })),
                }))}
              />
            </section>
          ) : null}

          <section aria-labelledby="by-course-heading" className={card}>
            <h2 id="by-course-heading" className="text-base font-bold text-navy-950">Seats by course</h2>
            {summary.length ? (
              <ul className="mt-3 divide-y divide-mist-100">
                {summary.map((row) => (
                  <li key={row.courseId} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5">
                    <span className="min-w-0 font-semibold text-navy-950">{row.courseTitle}</span>
                    <span className="flex flex-wrap gap-x-4 text-sm text-muted">
                      <span><strong className="text-navy-950">{row.available}</strong> to assign</span>
                      <span>{row.assigned} in use</span>
                      {row.expired ? <span>{row.expired} expired</span> : null}
                      {row.nextExpiry ? <span>Next expiry {date(row.nextExpiry)}</span> : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">No seats yet.</p>}
          </section>

          <section aria-labelledby="packs-heading" className={card}>
            <h2 id="packs-heading" className="text-base font-bold text-navy-950">Seat packs</h2>
            {packs.length ? (
              <ul className="mt-3 divide-y divide-mist-100">
                {packs.map((pack) => {
                  const refundable = writable && pack.status === 'paid' && !pack.seatRefund && Date.parse(pack.refundableUntil) > now && pack.seats.available > 0
                  return (
                    <li key={pack.orderId} className="grid gap-2 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="font-semibold text-navy-950">{pack.courseTitle}</p>
                        <p className="text-sm font-bold text-navy-950">{formatMoney(pack.amountMinor, pack.currency)}</p>
                      </div>
                      <p className="text-sm text-muted">
                        {pack.quantity} {pack.quantity === 1 ? 'seat' : 'seats'} × {formatMoney(pack.unitMinor, pack.currency)}
                        {volumeDiscountLabel(pack.volumeDiscountBasisPoints) ? ` (${volumeDiscountLabel(pack.volumeDiscountBasisPoints)})` : ''}
                        {' · '}Bought {date(pack.paidAt)}{pack.boughtBy ? ` by ${pack.boughtBy}` : ''}
                        {pack.validUntil ? ` · Assign by ${date(pack.validUntil)}` : ''}
                      </p>
                      <p className="text-sm text-muted">
                        {pack.status === 'refunded'
                          ? 'Refunded in full'
                          : `${pack.seats.available} to assign · ${pack.seats.assigned} in use${pack.seats.expired ? ` · ${pack.seats.expired} expired` : ''}${pack.seats.refunded ? ` · ${pack.seats.refunded} refunded` : ''}${pack.seats.held ? ` · ${pack.seats.held} refund in progress` : ''}`}
                      </p>
                      <div className="flex flex-wrap items-center gap-2">
                        {pack.invoiceId ? (
                          <a href={`/api/learn/invoices/${pack.invoiceId}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50">
                            <FileText aria-hidden="true" className="size-4" /> Invoice {pack.invoiceNumber}
                          </a>
                        ) : null}
                        {pack.creditNoteId ? (
                          <a href={`/api/learn/credit-notes/${pack.creditNoteId}`} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-mist-200 bg-white px-3 text-sm font-bold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50">
                            <FileText aria-hidden="true" className="size-4" /> Credit note {pack.creditNoteNumber}
                          </a>
                        ) : null}
                        {refundable ? <SeatRefundControl companyId={workspace.id} orderId={pack.orderId} available={pack.seats.available} /> : null}
                      </div>
                      {refundable ? <p className="text-xs text-muted">Unassigned seats can be refunded until {date(pack.refundableUntil)}, once for this pack.</p> : null}
                    </li>
                  )
                })}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">No seat packs yet.</p>}
          </section>
        </>
      ) : null}

      {crew ? (
        <>
          {writable ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <section aria-labelledby="invite-heading" className={card}>
                <h2 id="invite-heading" className="text-base font-bold text-navy-950">Invite crew</h2>
                <p className="mt-0.5 mb-4 text-sm text-muted">Each person gets an email. People without a Sea N Shore account join first. Seats can only go to people who accept.</p>
                <InviteCrewForm companyId={workspace.id} />
              </section>
              <section aria-labelledby="assign-heading" className={card}>
                <h2 id="assign-heading" className="text-base font-bold text-navy-950">Assign seats</h2>
                <p className="mt-0.5 mb-4 text-sm text-muted">Each learner is enrolled straight away with the plan the seat was bought with.</p>
                <AssignSeatsForm companyId={workspace.id} courses={assignOptions ?? []} />
              </section>
            </div>
          ) : null}

          {crew.invitations.length ? (
            <section aria-labelledby="invitations-heading" className={card}>
              <h2 id="invitations-heading" className="text-base font-bold text-navy-950">Waiting for an answer ({crew.invitations.length})</h2>
              <ul className="mt-3 divide-y divide-mist-100">
                {crew.invitations.map((invitation) => (
                  <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-navy-950">{invitation.email}</span>
                      <span className="block text-xs text-muted">
                        {[invitation.rank, invitation.vessel].filter(Boolean).join(' · ')}{invitation.rank || invitation.vessel ? ' · ' : ''}
                        Invited {date(invitation.createdAt)} · open until {date(invitation.expiresAt)}{invitation.emailStatus === 'failed' ? ' · email could not be delivered' : ''}
                      </span>
                    </span>
                    {writable ? <CancelInvitationButton companyId={workspace.id} invitationId={invitation.id} /> : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="crew-heading" className={card}>
            <h2 id="crew-heading" className="text-base font-bold text-navy-950">Crew ({crew.members.length})</h2>
            {crew.members.length ? (
              <ul className="mt-3 divide-y divide-mist-100">
                {crew.members.map((member) => (
                  <li key={member.profileId} className="flex flex-wrap items-center justify-between gap-3 py-3">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-semibold text-navy-950">{member.name}</span>
                        {member.status === 'active'
                          ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800"><ShieldCheck aria-hidden="true" className="size-3.5" /> Sharing</span>
                          : <span className="rounded-full bg-mist-100 px-2.5 py-0.5 text-xs font-bold text-navy-900">Stopped sharing</span>}
                      </span>
                      <span className="block text-xs text-muted">
                        {[member.rank, member.vessel].filter(Boolean).join(' · ') || 'No vessel or rank set'} · joined {date(member.joinedAt)} · {member.seats} {member.seats === 1 ? 'seat' : 'seats'}
                      </span>
                    </span>
                    {writable ? <CrewMemberControls companyId={workspace.id} profileId={member.profileId} name={member.name} vessel={member.vessel} rank={member.rank} /> : null}
                  </li>
                ))}
              </ul>
            ) : <p className="mt-2 text-sm text-muted">Nobody has joined yet. Invited people appear here once they accept.</p>}
          </section>
        </>
      ) : null}
    </OrganizationManageShell>
  )
}
