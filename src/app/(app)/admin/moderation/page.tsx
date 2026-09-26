import type { Metadata } from 'next'
import Link from 'next/link'
import { AdminEmptyState, AdminFilterBar, AdminPageHeader, AdminPanel } from '@/features/admin/components/admin-ui'
import { pluralize } from '@/lib/format'
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

export const metadata: Metadata = { title: 'Moderation · Admin' }

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
  if (targetType === 'profile') return `/admin/users/${targetId}`
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
    { value: 'profile', label: 'Profiles' },
  ]

  return (
    <main className="space-y-4">
      <AdminPageHeader
        title="Moderation & reports"
        meta={pluralize(cases.length, 'case') + ' in this view'}
        description="Reports about the same post, comment, job, event or profile are grouped into one case; repeated reports raise its priority."
      />

      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <AdminFilterBar
          label="Report status"
          options={statusFilters.map((filter) => ({
            href: `/admin/moderation?status=${filter.value}&type=${targetType}`,
            label: filter.label,
            active: status === filter.value,
          }))}
        />
        <AdminFilterBar
          label="Content type"
          options={typeFilters.map((filter) => ({
            href: `/admin/moderation?status=${status}&type=${filter.value}`,
            label: filter.label,
            active: targetType === filter.value,
          }))}
        />
      </div>

      <section className="space-y-4">
        {cases.map((item) => {
          const href = targetHref(item.targetType, item.targetId)
          const copyrightPrefix = '[COPYRIGHT/IP COMPLAINT]\n'
          const automatedPrefix = '[AUTOMATED MODERATION]\n'
          const copyrightComplaint = item.latestDetails?.startsWith(copyrightPrefix) ?? false
          const automatedDetails = item.latestDetails?.startsWith(automatedPrefix) ?? false
          const displayDetails = copyrightComplaint
            ? item.latestDetails?.slice(copyrightPrefix.length) ?? null
            : automatedDetails
              ? item.latestDetails?.slice(automatedPrefix.length) ?? null
              : item.latestDetails
          const highPriority = item.hasAutomatedFlag || copyrightComplaint || item.reasons.some((reason) => [
            'scam',
            'unsafe_or_illegal',
            'recruitment_fee',
            'fake_company',
            'suspicious_communication',
            'impersonation',
            'spam_or_scam',
            'fake_profile',
          ].includes(reason))

          return (
            <article key={`${item.targetType}-${item.targetId}`} className="rounded-xl border border-mist-100 bg-white p-5">
              <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-navy-950 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
                      {item.targetType}
                    </span>
                    <span className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-bold text-red-800">
                      {item.reportCount} report{item.reportCount === 1 ? '' : 's'}
                    </span>
                    {copyrightComplaint ? (
                      <span className="rounded-full bg-violet-50 px-2.5 py-1 text-xs font-bold text-violet-800">Copyright / IP complaint</span>
                    ) : null}
                    {item.hasAutomatedFlag ? (
                      <span className="rounded-full bg-sky-50 px-2.5 py-1 text-xs font-bold text-sky-800">Automated flag</span>
                    ) : null}
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
                        {item.targetType === 'profile' ? 'Open profile' : 'Open content'}
                      </Link>
                    ) : null}
                  </div>

                  {item.excerpt ? (
                    <p className="mt-3 line-clamp-4 whitespace-pre-wrap text-sm leading-6 text-ink">{item.excerpt}</p>
                  ) : (
                    <p className="mt-3 text-sm italic text-muted">{item.targetType === 'profile' ? 'Profile information is unavailable.' : 'Content is unavailable or has already been removed.'}</p>
                  )}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {item.reasons.map((reason) => (
                      <span key={reason} className="rounded-lg bg-mist-50 px-2.5 py-1.5 text-xs font-semibold text-navy-950">
                        {REPORT_REASON_LABELS[reason as ModerationReportReason] ?? reason.replaceAll('_', ' ')}
                      </span>
                    ))}
                  </div>

                  {displayDetails ? (
                    <blockquote className="mt-4 rounded-2xl border-l-4 border-red-300 bg-red-50/60 px-4 py-3 text-sm leading-6 text-red-950">
                      “{displayDetails}”
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
          <AdminPanel>
            <AdminEmptyState title="No moderation cases in this view" description="Change the status or content filter to review another queue." />
          </AdminPanel>
        ) : null}
      </section>
    </main>
  )
}
