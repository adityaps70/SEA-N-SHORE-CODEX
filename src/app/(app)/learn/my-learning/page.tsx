import type { Metadata } from 'next'
import Link from 'next/link'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { Archive, ArrowRight, Award, BadgeCheck, BookOpen, CheckCircle2, Clock, Download, ExternalLink, GraduationCap, RefreshCw } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { certificateRepository } from '@/features/learning/certificate-repository'
import { CoursePurchasesList } from '@/features/learning/components/course-purchases-list'
import { formatLearningDate, LearnerCertificatesList, ResumeCourseCard } from '@/features/learning/components/my-learning-home'
import { myLearningTabFrom } from '@/features/learning/components/my-learning-tab-names'
import { MyLearningTabs } from '@/features/learning/components/my-learning-tabs'
import { MyLearningCourseFilter, type MyLearningCourseGroup } from '@/features/learning/components/my-learning-course-filter'
import { coursePaymentRepository } from '@/features/learning/course-payment-repository'
import { courseInvitationClaims } from '@/features/learning/course-roster-repository'
import {
  enrollmentRepository,
  type LearnerCourseEnrollment,
} from '@/features/learning/enrollment-repository'
import { learnerHomeRepository } from '@/features/learning/learner-home-repository'
import { sessionRepository } from '@/features/learning/sessions/session-repository'
import { UpcomingSessionsCard } from '@/features/learning/sessions/components/learner-sessions-panel'
import { CompanyTrainingCard } from '@/features/learning/company-training/components/company-training-card'
import { crewRepository } from '@/features/learning/company-training/crew-repository'
import { DeviceTimeZoneSync } from '@/features/learning/sessions/components/device-time-zone-sync'
import { pluralize } from '@/lib/format'

export const metadata: Metadata = { title: 'My learning' }

type MyLearningPageProps = {
  searchParams?: Promise<{ tab?: string | string[] }>
}

function logLoadFailure(event: string) {
  return (error: unknown) => {
    console.error(event, { message: error instanceof Error ? error.message : null })
    return null
  }
}

/** A time-limited plan whose access has ended (learning round C): the learner can renew on the course page. */
function accessEndedAt(enrollment: LearnerCourseEnrollment, now: Date) {
  if (!enrollment.accessExpiresAt) return null
  const endsAt = new Date(enrollment.accessExpiresAt)
  return endsAt.getTime() <= now.getTime() ? endsAt : null
}

function levelLabel(level: LearnerCourseEnrollment['level']) {
  if (level === 'all_levels') return 'All levels'
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function formatLabel(format: LearnerCourseEnrollment['courseFormat']) {
  if (format === 'live_cohort') return 'Live cohort'
  if (format === 'hybrid') return 'Hybrid'
  return 'Recorded'
}

/** Round E (E7): which filter a course belongs to. Archived (or removed) courses always go to "Archived". */
function enrollmentGroup(enrollment: LearnerCourseEnrollment): MyLearningCourseGroup {
  if (enrollment.courseArchived) return 'archived'
  return enrollment.enrollmentStatus === 'completed' ? 'completed' : 'in_progress'
}

function EnrollmentCard({ enrollment, now }: { enrollment: LearnerCourseEnrollment; now: Date }) {
  const completed = enrollment.enrollmentStatus === 'completed'
  const accessEnded = accessEndedAt(enrollment, now)
  // A course that issues on its final quiz has a certificate before every material is complete (round B).
  const certificateAvailable = (completed && enrollment.certificateEnabled) || Boolean(enrollment.certificateId)

  return (
    <article
      aria-label={enrollment.title}
      className="overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]"
    >
      <div className="bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-5 text-white sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-semibold text-white/90">
            <BookOpen aria-hidden="true" className="size-3.5" /> {enrollment.category}
          </span>
          <span className="flex flex-wrap gap-1.5">
            {enrollment.courseArchived ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-950">
                <Archive aria-hidden="true" className="size-3.5" /> Archived
              </span>
            ) : null}
            {completed ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-navy-950">
                <CheckCircle2 aria-hidden="true" className="size-3.5" /> Completed
              </span>
            ) : null}
          </span>
        </div>
        <h2 className="mt-5 text-section-title font-bold">{enrollment.title}</h2>
        {enrollment.subtitle ? <p className="mt-2 text-sm leading-6 text-white/72">{enrollment.subtitle}</p> : null}
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{levelLabel(enrollment.level)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{formatLabel(enrollment.courseFormat)}</span>
          {enrollment.certificateEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-800">
              <Award aria-hidden="true" className="size-3.5" /> Certificate
            </span>
          ) : null}
        </div>

        <div className="mt-4 flex items-center gap-2 border-t border-mist-100 pt-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-950 text-xs font-extrabold text-white">
            {enrollment.mentorName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-navy-950">{enrollment.mentorName}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-teal-800">
              <BadgeCheck aria-hidden="true" className="size-3.5" /> Verified trainer
            </p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-mist-100 bg-mist-50/70 p-4">
          <div className="flex items-center justify-between gap-3 text-sm font-bold text-navy-950">
            <span>{enrollment.completedLessons} of {pluralize(enrollment.totalLessons, 'lesson')} completed</span>
            <span>{enrollment.progressPercent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label={`${enrollment.title} progress`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={enrollment.progressPercent}
            className="mt-3 h-2 overflow-hidden rounded-full bg-mist-200"
          >
            <div className="h-full rounded-full bg-teal-700" style={{ width: `${enrollment.progressPercent}%` }} />
          </div>
        </div>

        {accessEnded ? (
          <p className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-950">
            <Clock aria-hidden="true" className="size-4 shrink-0" /> Access ended on {formatLearningDate(accessEnded)}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          {accessEnded ? (
            <Link
              href={`/learn/courses/${enrollment.slug}`}
              aria-label={`Renew ${enrollment.title}`}
              className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              <RefreshCw aria-hidden="true" className="size-4" /> Renew
            </Link>
          ) : (
            <Link
              href={`/learn/courses/${enrollment.slug}/learn`}
              className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
            >
              {completed ? 'Review course' : 'Continue learning'} <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          )}

          {certificateAvailable ? (
            // Owner (21 Nov): a plain download link, never a Next.js <Link>, so nothing prefetches the PDF route.
            <a
              href={`/api/learn/certificates/enrollment/${enrollment.enrollmentId}`}
              download
              className="inline-flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-4 py-2.5 text-sm font-bold text-teal-900 transition hover:bg-teal-100"
            >
              <Download aria-hidden="true" className="size-4" />
              {enrollment.certificateId ? 'Download certificate' : 'Generate certificate'}
            </a>
          ) : null}

          {certificateAvailable && enrollment.certificateVerificationCode ? (
            <Link
              href={`/certificates/${enrollment.certificateVerificationCode}`}
              className="inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-mist-50"
            >
              Verify certificate <ExternalLink aria-hidden="true" className="size-4" />
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export default async function MyLearningPage({ searchParams }: MyLearningPageProps = {}) {
  const [user, query] = await Promise.all([
    requireAwsUser(),
    searchParams ?? Promise.resolve<{ tab?: string | string[] }>({}),
  ])
  // Round C (C1): a course a trainer invited this email address to is enrolled before the list loads.
  await courseInvitationClaims.forProfile(user.id).catch(logLoadFailure('course_invitation_claim_failed'))
  const [enrollments, purchases, certificates, resume, upcomingSessions, companyInvitations, companySharing] = await Promise.all([
    enrollmentRepository.listLearnerEnrollments(user.id),
    coursePaymentRepository.listLearnerPurchases(user.id).catch(logLoadFailure('learner_purchases_load_failed')),
    certificateRepository.listForLearner(user.id).catch(logLoadFailure('learner_certificates_load_failed')),
    // The Continue card is a shortcut: if it cannot be worked out, the page still shows every course.
    learnerHomeRepository.getResumeCourse(user.id).catch(logLoadFailure('learner_resume_load_failed')),
    // Round D: the next live sessions of the learner's batches (a convenience: the page works without it).
    sessionRepository.upcomingForLearner(user.id, 5).catch(logLoadFailure('learner_sessions_load_failed')),
    // D3: crew training invitations and the companies the learner shares assigned-course progress with.
    crewRepository.invitationsForMember(user.id).catch(logLoadFailure('company_invitations_load_failed')),
    crewRepository.sharingForMember(user.id).catch(logLoadFailure('company_sharing_load_failed')),
  ])
  const now = new Date()

  // Round E (E7): filter chips, newest activity first (the repository's order), archived courses kept apart.
  const coursesPanel = enrollments.length ? (
    <MyLearningCourseFilter
      items={enrollments.map((enrollment) => ({
        id: enrollment.enrollmentId,
        group: enrollmentGroup(enrollment),
        card: <EnrollmentCard enrollment={enrollment} now={now} />,
      }))}
    />
  ) : (
    <section className="mt-6 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center shadow-[var(--shadow-card)] max-md:mt-0 sm:p-10">
      <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-800">
        <GraduationCap aria-hidden="true" className="size-5" />
      </span>
      <h2 className="mt-4 text-xl font-bold text-navy-950">No courses yet</h2>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
        Courses you enroll in will appear here with their real progress and completion status.
      </p>
      <Link
        href="/learn"
        className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
      >
        Explore courses <ArrowRight aria-hidden="true" className="size-4" />
      </Link>
    </section>
  )

  const purchasesPanel = (
    <div className="max-md:px-4 max-md:pb-6">
      {purchases ? (
        <CoursePurchasesList purchases={purchases} className="mt-6" />
      ) : (
        <p role="status" className="mt-6 rounded-[1.4rem] border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950">
          We couldn&apos;t load your purchases just now. Refresh the page to try again — your courses and payments are safe.
        </p>
      )}
    </div>
  )

  return (
    <div className="mx-auto w-full max-w-page-wide px-4 py-6 max-md:px-0 max-md:py-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn" title="My learning" />
      {/* Phones: the page bar is the title, so the intro card is desktop-only. */}
      <section className="overflow-hidden rounded-[1.9rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] max-md:hidden sm:p-8 lg:p-10">
        <h1 className="text-page-title font-bold">My Learning</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 sm:text-base">
          Your enrolled maritime courses and real learning progress, in one place.
        </p>
      </section>

      {resume ? <ResumeCourseCard resume={resume} /> : null}
      {upcomingSessions?.length ? (
        <div className="mt-5 max-md:mt-3 max-md:px-4">
          <DeviceTimeZoneSync />
          <UpcomingSessionsCard sessions={upcomingSessions} now={now} />
        </div>
      ) : null}

      <CompanyTrainingCard invitations={companyInvitations ?? []} sharing={companySharing ?? []} />

      <MyLearningTabs
        initialTab={myLearningTabFrom(query.tab)}
        panels={{
          courses: coursesPanel,
          certificates: (
            <div className="max-md:px-4 max-md:pb-6">
              <LearnerCertificatesList certificates={certificates} />
            </div>
          ),
          purchases: purchasesPanel,
        }}
      />
    </div>
  )
}
