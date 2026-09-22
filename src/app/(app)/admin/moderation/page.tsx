import Link from 'next/link'
import { Flag, ShieldAlert } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { ModerationActionPanel } from '@/features/admin/components/moderation-action-panel'
import { adminRepository } from '@/features/admin/repository'
import {
  MODERATION_REPORT_STATUSES,
  MODERATION_TARGET_TYPES,
  REPORT_REASON_LABELS,
  type ModerationReportStatus,
  type ModerationTargetType,
  type ModerationReportReason,
} from '@/features/moderation/types'

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function targetHref(targetType: ModerationTargetType, targetId: string) {
  if (targetType === 'post') return `/posts/${targetId}`
  if (targetType === 'job') return `/jobs/${targetId}`
  if (targetType === 'event') return `/events/${targetId}`
  return null
}

export default async function AdminModerationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const requestedStatus = firstValue(params.status)
  const requestedType = firstValue(params.type)

  const status = MODERATION_REPORT_STATUSES.includes(requestedStatus as ModerationReportStatus)
    ? requestedStatus as ModerationReportStatus
    : 'open'
  const targetType = MODERATION_TARGET_TYPES.includes(requestedType as ModerationTargetType)
    ? requestedType as ModerationTargetType
    : 'all'

  const user = await requireAwsUser()
  const cases = await adminRepository.listModerationCases(user.id, {
    status,
    targetType,
    limit: 100,
  })

  const statusFilters: Array<{ value: ModerationReportStatus; label: string }> = [
    { value: 'open', label: 'Open' },
    { value: 'reviewing', label: 'Reviewing' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'dismissed', label: 'Dismissed' },
  ]
  const typeFilters: Array<{ value: ModerationTargetType | 'all'; label: string }> = [
    { value: 'all', label: 'All content' },
    { value: 'post', label: 'Posts' },
    { value: 'comment', label: 'Comments' },
    { value: 'job', label: 'Jobs' },
    { value: 'event', label: 'Events' },
  ]

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-red-700">
              <ShieldAlert aria-hidden="true" className="size-4" />
              Trust & safety
            </p>
            <h2 className="mt-2 text-2xl font-bold text-navy-950">Moderation & reports</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Review member reports across posts, comments, jobs and events. Reports for the same content are grouped into one case so repeated complaints raise the case priority instead of creating duplicate work.
            </p>
          </div>
          <div className="rounded-2xl bg-mist-50 px-4 py-3 text-sm font-semibold text-navy-950">
            {cases.length} case{cases.length === 1 ? '' : 's'} in this view
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {statusFilters.map((filter) => (
            <Link
              key={filter.value}
              href={`/admin/moderation?status=${filter.value}&type=${targetType}`}
              className={`rounded-full px-3.5 py-2 text-xs font-bold transition ${status === filter.value ? 'bg-navy-950 text-white' : 'bg-mist-50 text-muted hover:bg-mist-100 hover:text-navy-950'}`}
            >
              {filter.label}
            </Link>
          ))}
        </div>

        <div className="mt-3 flex flex-wrap gap-2 border-t border-mist-100 pt-3">
          {typeFilters.map((filter) => (
            <Link
              key={filter.value}
              href={`/admin/moderation?status=${status}&type=${filter.value}`}
              className={`rounded-xl px-3 py-2 text-xs font-bold transition ${targetType === filter.value ? 'bg-ocean-700 text-white' : 'border border-mist-100 bg-white text-muted hover:bg-mist-50 hover:text-navy-950'}`}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        {cases.map((item) => {
          const href = targetHref(item.targetType, item.targetId)
          const highPriority = item.reasons.some((reason) => [
            'scam',
            'unsafe_or_illegal',
            'recruitment_fee',
            'fake_company',
            'suspicious_communication',
          ].includes(reason))

          return (
            <article key={`${item.targetType}-${item.targetId}`} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-navy-950 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
                      {item.targetType}
                    </span>
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800">
                      {item.reportCount} report{item.reportCount === 1 ? '' : 's'}
                    </span>
                    {highPriority ? (
                      <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold text-amber-800">Priority review</span>
                    ) : null}
                    <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold capitalize text-muted">
                      {item.targetState}
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap items-start gap-x-3 gap-y-1">
                    <h3 className="text-xl font-bold text-navy-950">{item.title}</h3>
                    {href ? (
                      <Link href={href} className="text-sm font-bold text-ocean-700 hover:underline">
                        Open content
                      </Link>
                    ) : null}
                  </div>

                  {item.excerpt ? (
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-ink">{item.excerpt}</p>
                  ) : (
                    <p className="mt-3 text-sm italic text-muted">Content is unavailable or has already been removed.</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.reasons.map((reason) => (
                      <span key={reason} className="rounded-lg bg-mist-50 px-2.5 py-1.5 text-xs font-semibold text-navy-950">
                        {REPORT_REASON_LABELS[reason as ModerationReportReason] ?? reason.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>

                  {item.latestDetails ? (
                    <blockquote className="mt-4 rounded-2xl border-l-4 border-red-300 bg-red-50/60 px-4 py-3 text-sm leading-6 text-red-950">
                      “{item.latestDetails}”
                    </blockquote>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-x-5 gap-y-1 text-xs font-medium text-muted">
                    <span>First report: {formatDate(item.firstReportedAt)}</span>
                    <span>Latest report: {formatDate(item.latestReportedAt)}</span>
                    {item.owner.id ? (
                      item.owner.slug
                        ? <Link href={`/people/${item.owner.slug}`} className="font-semibold text-ocean-700 hover:underline">Owner: {item.owner.fullName}</Link>
                        : <span>Owner: {item.owner.fullName}</span>
                    ) : <span>Owner unavailable</span>}
                  </div>
                </div>

                <ModerationActionPanel
                  targetType={item.targetType}
                  targetId={item.targetId}
                  targetState={item.targetState}
                />
              </div>
            </article>
          )
        })}

        {cases.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-10 text-center">
            <Flag aria-hidden="true" className="mx-auto size-7 text-muted" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">No moderation cases in this view</h3>
            <p className="mt-2 text-sm text-muted">Change the status or content filter to review another queue.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
