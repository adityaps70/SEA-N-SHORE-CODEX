import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AlertTriangle, ArrowLeft, Archive, BadgeCheck, Clock3, FilePenLine } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { WorksBestOnComputer } from '@/features/learning/components/works-best-on-computer'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseEditSession } from '@/features/learning/components/course-edit-session'
import { CourseForm } from '@/features/learning/components/course-form'
import { CourseSubmitControl } from '@/features/learning/components/course-submit-control'
import { CourseWithdrawControl } from '@/features/learning/components/course-withdraw-control'
import { MentorCurriculumEditor } from '@/features/learning/components/mentor-curriculum-editor'
import {
  courseRepository,
  type CourseDraftInput,
  type MentorOwnedCourseDetail,
} from '@/features/learning/course-repository'
import { loadSellerFeeTerms } from '@/features/learning/course-seller-fees'
import { canMentorEditCourse } from '@/features/learning/course-workflow'
import { mentorMaterialRepository } from '@/features/learning/mentor-material-repository'

export const metadata: Metadata = { title: 'Edit course' }

function formatDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(date)
}

function ReviewerNote({ course, label = 'Reviewer note' }: { course: MentorOwnedCourseDetail; label?: string }) {
  const review = course.lastReview
  if (!review?.note) return null
  const reviewedOn = formatDate(review.reviewedAt)
  return (
    <div className="mt-3 rounded-xl border border-navy-950/10 bg-white/70 p-3">
      <p className="text-xs font-bold uppercase tracking-[0.12em]">
        {label}{reviewedOn ? ` · ${reviewedOn}` : ''}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{review.note}</p>
    </div>
  )
}

function StatusBanner({ course }: { course: MentorOwnedCourseDetail }) {
  if (course.status === 'draft') {
    if (course.lastReview?.decision !== 'changes_requested' || !course.lastReview.note) return null
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="flex items-center gap-2 font-bold">
          <AlertTriangle aria-hidden="true" className="size-5 shrink-0" /> Draft · previous review feedback
        </p>
        <p className="mt-1 text-sm leading-6">You withdrew this course from review. Make your changes, then submit it again.</p>
        <ReviewerNote course={course} />
      </section>
    )
  }

  if (course.status === 'changes_requested') {
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
        <p className="flex items-center gap-2 font-bold">
          <AlertTriangle aria-hidden="true" className="size-5 shrink-0" /> Changes requested by Sea N Shore review
        </p>
        <p className="mt-1 text-sm leading-6">Edit the course below and save, then resubmit it. The reviewer will see what you changed since their review.</p>
        {course.lastReview?.note ? <ReviewerNote course={course} /> : course.adminReviewNote ? (
          <div className="mt-3 rounded-xl border border-navy-950/10 bg-white/70 p-3">
            <p className="text-xs font-bold uppercase tracking-[0.12em]">Reviewer note</p>
            <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{course.adminReviewNote}</p>
          </div>
        ) : null}
      </section>
    )
  }

  if (course.status === 'submitted') {
    const submittedOn = formatDate(course.submittedAt)
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950">
        <p className="flex items-center gap-2 font-bold">
          <Clock3 aria-hidden="true" className="size-5 shrink-0" /> In review{submittedOn ? ` · submitted ${submittedOn}` : ''}
        </p>
        <p className="mt-1 text-sm leading-6">
          Editing is locked while Sea N Shore reviews this course, so the reviewer sees exactly what you submitted. To change something, withdraw it from review, edit, and submit it again.
        </p>
        {course.lastReview?.decision === 'changes_requested' ? <ReviewerNote course={course} label="Feedback from the last review" /> : null}
        <CourseWithdrawControl courseId={course.id} />
      </section>
    )
  }

  if (course.status === 'archived') {
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-mist-200 bg-mist-50 p-5 text-navy-950">
        <p className="flex items-center gap-2 font-bold">
          <Archive aria-hidden="true" className="size-5 shrink-0" /> Archived · read-only
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">This course has been removed from the marketplace and can no longer be edited.</p>
      </section>
    )
  }

  return (
    <section aria-label="Review status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
      <p className="flex items-center gap-2 font-bold">
        <BadgeCheck aria-hidden="true" className="size-5 shrink-0" /> Published · read-only
      </p>
      <p className="mt-1 text-sm leading-6">
        This course is live exactly as the reviewer approved it, and enrolled learners’ progress depends on it. Published courses can’t be edited in Learning Studio yet.
      </p>
      {course.lastReview?.note ? <ReviewerNote course={course} /> : null}
    </section>
  )
}

export default async function EditMentorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  const user = await requireAwsUser()
  const course = await courseRepository.getOwnedCourse(user.id, courseId)
  if (!course) return notFound()

  const [curriculum, sellerFee] = await Promise.all([
    mentorMaterialRepository.getCurriculum(user.id, courseId),
    // The seller is the course's organization, or the trainer who owns a personal course.
    loadSellerFeeTerms(course.companyId ? { companyId: course.companyId } : { profileId: user.id }),
  ])
  if (!curriculum) return notFound()

  const editable = canMentorEditCourse(course.status)

  const initialValue: CourseDraftInput = {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    category: course.category,
    level: course.level,
    language: course.language,
    thumbnailPath: course.thumbnailPath,
    trailerPath: course.trailerPath,
    learningOutcomes: course.learningOutcomes,
    requirements: course.requirements,
    targetAudience: course.targetAudience,
    accessType: course.accessType,
    priceMinor: course.priceMinor,
    discountPriceMinor: course.discountPriceMinor,
    currency: course.currency,
    certificateEnabled: course.certificateEnabled,
    courseFormat: course.courseFormat,
  }

  return (
    <div className="mx-auto w-full max-w-6xl py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio" title={editable ? 'Edit course' : 'View course'} />
      <WorksBestOnComputer>The course editor and SCORM upload work best on a computer. Everything still works here.</WorksBestOnComputer>
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" /> Learning Studio
      </Link>

      <CourseEditSession initialDetailsRevision={course.detailsRevision}>
        <section className="mt-5 rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
          <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
            <FilePenLine aria-hidden="true" className="size-4" /> {editable ? 'Private course draft' : 'Course (read-only)'}
          </p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">{editable ? 'Edit course' : 'View course'}</h1>
          <p className="mt-2 break-words text-lg font-semibold text-navy-900">{course.title}</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {editable
              ? 'Refine the course foundation and curriculum, save your changes, then submit it for Sea N Shore review. Learners cannot access this course while it remains editable in Learning Studio.'
              : 'You can review everything in this course below. Fields are locked in its current status.'}
          </p>
        </section>

        <StatusBanner course={course} />

        <div className="mt-5">
          <CourseForm
            key={course.id}
            initialValue={initialValue}
            courseId={course.id}
            publisherName={course.publisherName}
            readOnly={!editable}
            sellerFees={{ default: sellerFee }}
          />
        </div>

        <div className="mt-5">
          <MentorCurriculumEditor courseId={course.id} curriculum={curriculum} readOnly={!editable} />
        </div>

        {editable ? (
          <div className="mt-5">
            <CourseSubmitControl courseId={course.id} resubmission={course.status === 'changes_requested' || course.lastReview?.decision === 'changes_requested'} />
          </div>
        ) : null}
      </CourseEditSession>
    </div>
  )
}
