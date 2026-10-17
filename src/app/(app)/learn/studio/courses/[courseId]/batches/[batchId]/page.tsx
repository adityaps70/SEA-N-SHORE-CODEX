import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, Users } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { BatchError, batchRepository } from '@/features/learning/batches/batch-repository'
import { batchStartLabel, batchStatusLabel, seatsLeft } from '@/features/learning/batches/batch-rules'
import { BatchForm, BatchStaffPanel } from '@/features/learning/batches/components/batch-forms'
import { BatchTabs } from '@/features/learning/batches/components/batch-tabs'
import { formatZonedTime } from '@/features/learning/sessions/session-time'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'Batch' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Round D (D1): one batch. Course managers edit it and its team; the batch's own manager and instructors see it
 * read-only, with their learners and sessions.
 */
export default async function CourseBatchPage({ params }: { params: Promise<{ courseId: string; batchId: string }> }) {
  const { courseId, batchId } = await params
  if (!UUID.test(courseId) || !UUID.test(batchId)) notFound()
  const user = await requireAwsUser()
  const allCourses = await canUsePlatformAdminAuthority(user.id)
  const staff = await batchRepository.getForStaff({ actorId: user.id, allCourses }, batchId).catch((error: unknown) => {
    if (error instanceof BatchError && error.code === 'batch_not_found') return null
    throw error
  })
  if (!staff || staff.course.id !== courseId) notFound()
  const { batch, course, canManageCourse, instructors } = staff
  const left = seatsLeft(batch)
  const backHref = canManageCourse ? `/learn/studio/courses/${course.id}/batches` : '/learn/studio'

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref={backHref} title="Batch" />
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> {canManageCourse ? 'All batches' : 'Learning Studio'}
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><CalendarDays aria-hidden="true" className="size-4" /> {course.title}</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight">{batch.title}</h1>
        <p className="mt-3 text-sm text-white/70">
          {batchStartLabel(batch)} · {batchStatusLabel(batch.status)}
        </p>
        <p className="mt-1 text-sm text-white/70">
          {batch.enrolledCount} enrolled{batch.seatLimit !== null ? ` of ${pluralize(batch.seatLimit, 'seat')} (${left} left)` : ' · no seat limit'}
          {batch.heldCount ? ` · ${batch.heldCount} at checkout` : ''}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={`/learn/studio/courses/${course.id}/learners?batch=${batch.id}`}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50"
          >
            <Users aria-hidden="true" className="size-4" /> Learners in this batch
          </Link>
        </div>
      </section>

      <BatchTabs courseId={course.id} batchId={batch.id} active="overview" />

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {canManageCourse ? <BatchForm courseId={course.id} batch={batch} /> : (
          <section aria-labelledby="batch-details-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <h2 id="batch-details-heading" className="text-base font-bold text-navy-950">Batch details</h2>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="font-semibold text-navy-950">Starts</dt>
              <dd className="text-navy-800">{formatZonedTime(batch.startsAt, batch.timeZone, { withYear: true })}</dd>
              <dt className="font-semibold text-navy-950">Ends</dt>
              <dd className="text-navy-800">{batch.endsAt ? formatZonedTime(batch.endsAt, batch.timeZone, { withYear: true }) : 'No end date'}</dd>
              <dt className="font-semibold text-navy-950">Enrolment</dt>
              <dd className="text-navy-800">{batch.enrolmentOpen ? 'Open' : 'Closed'}</dd>
            </dl>
          </section>
        )}
        <BatchStaffPanel
          courseId={course.id}
          batchId={batch.id}
          managerName={batch.managerName}
          instructors={instructors}
          canManage={canManageCourse}
        />
      </div>
    </div>
  )
}
