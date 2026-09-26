import type { Metadata } from 'next'
import Link from 'next/link'
import { Activity, FileClock } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  adminRepository,
  type AdminAuditTargetType,
} from '@/features/admin/repository'

export const metadata: Metadata = { title: 'Audit log · Admin' }

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function actionLabel(action: string) {
  return action
    .replaceAll('.', ' · ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function targetLabel(targetType: string) {
  if (targetType === 'organization_application') return 'Organization'
  return targetType.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function targetHref(targetType: string, targetId: string) {
  if (targetType === 'post') return `/posts/${targetId}`
  if (targetType === 'job') return `/jobs/${targetId}`
  if (targetType === 'event') return `/events/${targetId}`
  if (targetType === 'organization_application') return `/admin/organizations/${targetId}`
  return null
}

function metadataText(metadata: Record<string, unknown>) {
  const values: string[] = []
  const note = typeof metadata.note === 'string' ? metadata.note.trim() : ''
  const reviewerNote = typeof metadata.reviewerNote === 'string' ? metadata.reviewerNote.trim() : ''
  const decision = typeof metadata.decision === 'string' ? metadata.decision.trim() : ''
  const previousState = typeof metadata.previousState === 'string' ? metadata.previousState.trim() : ''
  const reportCount = typeof metadata.reportCount === 'number'
    ? metadata.reportCount
    : typeof metadata.reportCount === 'string' && /^\d+$/.test(metadata.reportCount)
      ? Number(metadata.reportCount)
      : null

  if (decision) values.push(`Decision: ${decision.replaceAll('_', ' ')}`)
  if (previousState) values.push(`Previous state: ${previousState.replaceAll('_', ' ')}`)
  if (reportCount !== null) values.push(`${reportCount} report${reportCount === 1 ? '' : 's'}`)
  if (note) values.push(note)
  else if (reviewerNote) values.push(reviewerNote)

  return values
}

export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const requestedType = firstValue(params.type)
  const allowedTypes: AdminAuditTargetType[] = [
    'all',
    'post',
    'comment',
    'job',
    'event',
    'organization_application',
  ]
  const targetType = allowedTypes.includes(requestedType as AdminAuditTargetType)
    ? requestedType as AdminAuditTargetType
    : 'all'

  const user = await requireAwsUser()
  const events = await adminRepository.listAuditEvents(user.id, {
    targetType,
    limit: 100,
  })

  const filters: Array<{ value: AdminAuditTargetType; label: string }> = [
    { value: 'all', label: 'All activity' },
    { value: 'post', label: 'Posts' },
    { value: 'comment', label: 'Comments' },
    { value: 'job', label: 'Jobs' },
    { value: 'event', label: 'Events' },
    { value: 'organization_application', label: 'Organizations' },
  ]

  return (
    <main className="space-y-5">
      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">
              <Activity aria-hidden="true" className="size-4" />
              Operations history
            </p>
            <h2 className="mt-2 text-2xl font-bold text-navy-950">Audit log</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
              Review administrator and moderation decisions across the platform. This history is read-only and ordered newest first.
            </p>
          </div>
          <div className="rounded-2xl bg-mist-50 px-4 py-3 text-sm font-semibold text-navy-950">
            {events.length} event{events.length === 1 ? '' : 's'} shown
          </div>
        </div>

        <div className="mt-5 flex flex-wrap gap-2">
          {filters.map((filter) => (
            <Link
              key={filter.value}
              href={`/admin/audit?type=${filter.value}`}
              className={`rounded-xl px-3.5 py-2 text-xs font-bold transition ${
                targetType === filter.value
                  ? 'bg-navy-950 text-white'
                  : 'border border-mist-100 bg-white text-muted hover:bg-mist-50 hover:text-navy-950'
              }`}
            >
              {filter.label}
            </Link>
          ))}
        </div>
      </section>

      <section className="space-y-3">
        {events.map((event) => {
          const href = targetHref(event.targetType, event.targetId)
          const details = metadataText(event.metadata)
          return (
            <article
              key={event.id}
              className="rounded-[1.35rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-navy-950 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.08em] text-white">
                      {targetLabel(event.targetType)}
                    </span>
                    <span className="text-sm font-bold text-navy-950">{actionLabel(event.action)}</span>
                  </div>
                  <p className="mt-2 text-sm text-muted">
                    By{' '}
                    {event.actor.slug ? (
                      <Link href={`/people/${event.actor.slug}`} className="font-semibold text-ocean-700 hover:underline">
                        {event.actor.fullName}
                      </Link>
                    ) : (
                      <span className="font-semibold text-navy-950">{event.actor.fullName}</span>
                    )}
                  </p>
                  {details.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {details.map((detail) => (
                        <span key={detail} className="rounded-lg bg-mist-50 px-2.5 py-1.5 text-xs font-medium text-navy-900">
                          {detail}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  {href ? (
                    <Link href={href} className="mt-3 inline-flex text-xs font-bold text-ocean-700 hover:underline">
                      Open target
                    </Link>
                  ) : null}
                </div>
                <time dateTime={event.createdAt} className="shrink-0 text-xs font-medium text-muted">
                  {formatDate(event.createdAt)}
                </time>
              </div>
            </article>
          )
        })}

        {events.length === 0 ? (
          <section className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-10 text-center">
            <FileClock aria-hidden="true" className="mx-auto size-7 text-muted" />
            <h3 className="mt-3 text-lg font-bold text-navy-950">No audit activity in this view</h3>
            <p className="mt-2 text-sm text-muted">Choose another filter to review more administrator activity.</p>
          </section>
        ) : null}
      </section>
    </main>
  )
}
