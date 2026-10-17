import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Download, Mail, Megaphone, Users } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { CourseAnnouncementComposer } from '@/features/learning/components/course-announcement-composer'
import { canUsePlatformAdminAuthority } from '@/features/admin/mfa-gate'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CancelInvitationButton, CourseRosterEnrolForm } from '@/features/learning/components/course-roster-enrol-form'
import {
  rosterCertificateLabel,
  rosterQuizLabel,
  rosterSourceLabel,
  rosterStatusLabel,
  type RosterLearner,
} from '@/features/learning/course-roster'
import { courseRosterRepository } from '@/features/learning/course-roster-repository'
import { batchRepository } from '@/features/learning/batches/batch-repository'
import { batchClosedLabel, batchClosedReason, type CourseBatch } from '@/features/learning/batches/batch-rules'

export const metadata: Metadata = { title: 'Learners' }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function dateLabel(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(date)
}

function LearnerName({ learner }: { learner: RosterLearner }) {
  return learner.slug ? (
    <Link href={`/people/${learner.slug}`} className="font-bold text-ocean-700 underline-offset-2 hover:underline">{learner.name}</Link>
  ) : <span className="font-bold text-navy-950">{learner.name}</span>
}

function Progress({ learner }: { learner: RosterLearner }) {
  return (
    <span className="flex min-w-24 items-center gap-2">
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-mist-100" aria-hidden="true">
        <span className="block h-full rounded-full bg-teal-600" style={{ width: `${learner.progressPercent}%` }} />
      </span>
      <span className="text-sm font-semibold text-navy-950">{learner.progressPercent}%</span>
    </span>
  )
}

/**
 * Round C (C1): who is on a course, how far they are, and adding learners by email.
 * Round D: on a batch course, a batch filter (`?batch=`) and the Batch column; a batch's manager and instructors see
 * their batch only, read-only.
 */
export default async function CourseLearnersPage({ params, searchParams }: {
  params: Promise<{ courseId: string }>
  searchParams?: Promise<{ batch?: string | string[] }>
}) {
  const { courseId } = await params
  if (!UUID.test(courseId)) notFound()
  const batchParam = (await searchParams)?.batch
  const batchId = typeof batchParam === 'string' && UUID.test(batchParam) ? batchParam : null
  const user = await requireAwsUser()
  const allCourses = await canUsePlatformAdminAuthority(user.id)
  const roster = await courseRosterRepository.list({ actorId: user.id, courseId, allCourses, batchId }).catch((error: unknown) => {
    if (error instanceof Error && error.message === 'course_not_found') return null
    throw error
  })
  if (!roster) notFound()
  const { course, learners, invitations } = roster
  const batchCourse = course.batchMode === 'batches'
  let batches: CourseBatch[] = []
  if (batchCourse) {
    batches = course.canManage
      ? (await batchRepository.listForCourse({ actorId: user.id, allCourses }, course.id)).batches
      : batchId ? [(await batchRepository.getForStaff({ actorId: user.id, allCourses }, batchId)).batch] : []
  }
  const selectedBatch = batches.find((batch) => batch.id === batchId) ?? null
  const exportHref = `/api/learn/courses/${course.id}/roster${batchId ? `?batch=${batchId}` : ''}`
  const backHref = course.canManage ? `/learn/studio/courses/${course.id}/edit` : `/learn/studio/courses/${course.id}/batches/${batchId}`
  const now = new Date()
  const active = learners.filter((learner) => learner.status !== 'revoked')
  const certified = learners.filter((learner) => learner.certificate === 'issued').length

  return (
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref={backHref} title="Learners" />
      <Link href={backHref} className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> {course.canManage ? 'Back to the course' : 'Back to the batch'}
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:mt-3 sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200"><Users aria-hidden="true" className="size-4" /> Learners</p>
        <h1 className="mt-2 break-words text-3xl font-bold tracking-tight">{course.title}</h1>
        {selectedBatch ? <p className="mt-1 text-sm font-semibold text-teal-100">Batch: {selectedBatch.title}</p> : null}
        <p className="mt-3 text-sm text-white/70">
          {active.length} learning · {certified} certified{invitations.length ? ` · ${invitations.length} invited` : ''}
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <a
            href={exportHref}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50"
          >
            <Download aria-hidden="true" className="size-4" /> Download CSV
          </a>
        </div>
        <p className="mt-3 text-xs text-white/60">Learner details are for running this course only. Downloads are recorded.</p>
      </section>

      {batchCourse && batches.length ? (
        <nav aria-label="Filter by batch" className="mt-5 flex flex-wrap gap-2">
          {course.canManage ? (
            <Link
              href={`/learn/studio/courses/${course.id}/learners`}
              aria-current={batchId ? undefined : 'page'}
              className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-bold ${batchId ? 'border-mist-200 bg-white text-navy-900 hover:border-teal-400' : 'border-navy-950 bg-navy-950 text-white'}`}
            >
              All batches
            </Link>
          ) : null}
          {batches.map((batch) => (
            <Link
              key={batch.id}
              href={`/learn/studio/courses/${course.id}/learners?batch=${batch.id}`}
              aria-current={batch.id === batchId ? 'page' : undefined}
              className={`inline-flex min-h-10 items-center rounded-full border px-4 text-sm font-bold ${batch.id === batchId ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-navy-900 hover:border-teal-400'}`}
            >
              {batch.title}
            </Link>
          ))}
        </nav>
      ) : null}

      {course.canManage ? (
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <CourseRosterEnrolForm
          courseId={course.id}
          disabledReason={course.openToNewLearners
            ? batchCourse && batches.length === 0 ? 'Add a batch on the Batches page first, then add learners to it.' : null
            : 'Learners can be added once the course is published and open to new learners.'}
          batches={batchCourse ? batches.filter((batch) => batch.status !== 'archived').map((batch) => {
            const reason = batchClosedReason(batch)
            return { id: batch.id, title: batch.title, closedLabel: reason ? batchClosedLabel(reason) : null }
          }) : undefined}
          defaultBatchId={batchId}
        />
        <section aria-labelledby="invitations-heading" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 id="invitations-heading" className="flex items-center gap-2 text-base font-bold text-navy-950"><Mail aria-hidden="true" className="size-4 text-teal-700" /> Invitations waiting</h2>
          {invitations.length ? (
            <ul className="mt-3 divide-y divide-mist-100">
              {invitations.map((invitation) => (
                <li key={invitation.id} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block break-all text-sm font-semibold text-navy-950">{invitation.email}</span>
                    <span className="block text-xs text-muted">
                      Invited {dateLabel(invitation.createdAt)} · open until {dateLabel(invitation.expiresAt)}
                      {invitation.emailStatus === 'failed' ? ' · the email could not be delivered' : ''}
                    </span>
                  </span>
                  <CancelInvitationButton courseId={course.id} invitationId={invitation.id} />
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-muted">No invitations waiting.</p>}
        </section>
      </div>
      ) : null}

      {active.length && course.canManage ? (
        <section aria-labelledby="message-all-heading" className="mt-5 rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <h2 id="message-all-heading" className="flex items-center gap-2 text-base font-bold text-navy-950">
            <Megaphone aria-hidden="true" className="size-4 text-teal-700" /> Message all learners
          </h2>
          <p className="mt-1 text-sm leading-6 text-muted">
            Posted as a course announcement: learners see it in the course and get one email (unless they turned learning emails off). Up to three a day per course.
          </p>
          <div className="mt-3">
            <CourseAnnouncementComposer courseId={course.id} />
          </div>
        </section>
      ) : null}

      <section aria-labelledby="roster-heading" className="mt-6">
        <h2 id="roster-heading" className="text-lg font-bold text-navy-950">Roster</h2>
        {learners.length === 0 ? (
          <p className="mt-3 rounded-2xl border border-mist-100 bg-white p-5 text-sm text-muted">No learners yet.</p>
        ) : (
          <>
            <div className="mt-3 overflow-x-auto rounded-[1.4rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:hidden">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="border-b border-mist-100 text-xs font-bold uppercase tracking-[0.1em] text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3">Learner</th>
                    <th scope="col" className="px-4 py-3">Enrolled</th>
                    <th scope="col" className="px-4 py-3">Progress</th>
                    <th scope="col" className="px-4 py-3">Last active</th>
                    <th scope="col" className="px-4 py-3">Quiz best scores</th>
                    <th scope="col" className="px-4 py-3">Certificate</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-mist-100">
                  {learners.map((learner) => (
                    <tr key={learner.enrollmentId} className="align-top">
                      <td className="px-4 py-3">
                        <LearnerName learner={learner} />
                        <span className="block text-xs text-muted">{learner.rank ?? 'Rank not shared'}</span>
                        <span className="block text-xs text-muted">{rosterStatusLabel(learner, now)}</span>
                        {batchCourse ? <span className="block text-xs text-muted">Batch: {learner.batchTitle ?? 'None'}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-navy-800">
                        {dateLabel(learner.enrolledAt)}
                        <span className="block text-xs text-muted">{rosterSourceLabel(learner.source, learner.companySeat)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <Progress learner={learner} />
                        <span className="block text-xs text-muted">{learner.completedLessons} of {learner.totalLessons} lessons</span>
                      </td>
                      <td className="px-4 py-3 text-navy-800">{dateLabel(learner.lastActiveAt)}</td>
                      <td className="max-w-xs px-4 py-3 text-xs leading-5 text-navy-800">{rosterQuizLabel(learner.quizScores) || '—'}</td>
                      <td className="px-4 py-3 text-navy-800">{rosterCertificateLabel(learner.certificate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="mt-3 space-y-3 md:hidden">
              {learners.map((learner) => (
                <li key={learner.enrollmentId} className="rounded-[1.2rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <LearnerName learner={learner} />
                      <p className="text-xs text-muted">{learner.rank ?? 'Rank not shared'} · {rosterStatusLabel(learner, now)}</p>
                      {batchCourse ? <p className="text-xs text-muted">Batch: {learner.batchTitle ?? 'None'}</p> : null}
                    </div>
                    <Progress learner={learner} />
                  </div>
                  <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-navy-800">
                    <dt className="font-semibold">Enrolled</dt>
                    <dd>{dateLabel(learner.enrolledAt)} · {rosterSourceLabel(learner.source, learner.companySeat)}</dd>
                    <dt className="font-semibold">Last active</dt>
                    <dd>{dateLabel(learner.lastActiveAt)}</dd>
                    <dt className="font-semibold">Quizzes</dt>
                    <dd className="break-words">{rosterQuizLabel(learner.quizScores) || '—'}</dd>
                    <dt className="font-semibold">Certificate</dt>
                    <dd>{rosterCertificateLabel(learner.certificate)}</dd>
                  </dl>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  )
}
