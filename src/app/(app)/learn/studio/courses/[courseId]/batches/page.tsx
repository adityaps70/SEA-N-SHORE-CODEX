import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, CalendarDays, ChevronRight } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { BatchError, batchRepository } from '@/features/learning/batches/batch-repository'
import { batchStartLabel, batchStatusLabel, seatsLeft } from '@/features/learning/batches/batch-rules'
import { BatchForm, BatchSettingsForm } from '@/features/learning/batches/components/batch-forms'

export const metadata: Metadata = { title: 'Batches' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Round D (D1): a course's batch settings and its batches, for the course's managers. */
export default async function CourseBatchesPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params
  if (!UUID.test(courseId)) notFound()
  const user = await requireAwsUser()
  const allCourses = await canUsePlatformAdminAuthority(user.id)
  const data = await batchRepository.listForCourse({ actorId: user.id, allCourses }, courseId).catch((error: unknown) => {
    if (error instanceof BatchError && error.code === 'course_not_found') return null
    throw error
  })
  if (!data) notFound()
  const { course, batches } = data
  const batchCourse = course.settings.batchMode === 'batches'

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref={`/learn/studio/courses/${course.id}/edit`} title="Batches" />
      <Link href={`/learn/studio/courses/${course.id}/edit`} className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Back to the course
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><CalendarDays aria-hidden="true" className="size-4" /> Batches</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight">{course.title}</h1>
        <p className="mt-3 text-sm text-white/70">
          {batchCourse ? `${batches.length} ${batches.length === 1 ? 'batch' : 'batches'} · learners choose a batch when they join` : 'Self-paced: learners join any time.'}
        </p>
      </section>

      <div className="mt-5 grid gap-5">
        <BatchSettingsForm courseId={course.id} settings={course.settings} />

        {batchCourse ? (
          <>
            <section aria-labelledby="batch-list-heading">
              <h2 id="batch-list-heading" className="text-lg font-bold text-navy-950">Batches</h2>
              {batches.length ? (
                <ul className="mt-3 grid gap-3">
                  {batches.map((batch) => {
                    const left = seatsLeft(batch)
                    return (
                      <li key={batch.id}>
                        <Link
                          href={`/learn/studio/courses/${course.id}/batches/${batch.id}`}
                          className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-mist-200 bg-white p-4 shadow-[var(--shadow-card)] hover:border-teal-300"
                        >
                          <span className="min-w-0">
                            <span className="block break-words font-bold text-navy-950">{batch.title}</span>
                            <span className="block text-sm text-muted">{batchStartLabel(batch)} · {batchStatusLabel(batch.status)}</span>
                            <span className="block text-sm text-muted">
                              {batch.enrolledCount} enrolled{batch.seatLimit !== null ? ` of ${batch.seatLimit} seats (${left} left)` : ' · no seat limit'}
                              {batch.managerName ? ` · Manager: ${batch.managerName}` : ''}
                              {batch.enrolmentOpen ? '' : ' · Enrolment closed'}
                            </span>
                          </span>
                          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              ) : <p className="mt-3 rounded-2xl border border-mist-100 bg-white p-5 text-sm text-muted">No batches yet. Add the first one below; learners can join once it is open for enrolment.</p>}
            </section>
            <BatchForm courseId={course.id} />
          </>
        ) : null}
      </div>
    </div>
  )
}
