import type { Metadata } from 'next'
import { cache } from 'react'
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
import { CourseRevisionDiscardControl, CourseRevisionStartControl } from '@/features/learning/components/course-revision-controls'
import { MentorCurriculumEditor } from '@/features/learning/components/mentor-curriculum-editor'
import { CertificateSettingsPanel } from '@/features/learning/components/certificate-settings-panel'
import { CoursePricingPlansPanel } from '@/features/learning/components/course-pricing-plans-panel'
import { coursePlanRepository } from '@/features/learning/course-plan-repository'
import { DEFAULT_CERTIFICATE_SETTINGS } from '@/features/learning/certificate-settings'
import {
  courseRepository,
  type CourseDraftInput,
  type MentorOwnedCourseDetail,
} from '@/features/learning/course-repository'
import { loadSellerFeeTerms } from '@/features/learning/course-seller-fees'
import { canMentorEditCourse } from '@/features/learning/course-workflow'
import { mentorMaterialRepository } from '@/features/learning/mentor-material-repository'
import { ARTICLE_IMAGE_PATH_ATTRIBUTE, renderArticleHtml } from '@/features/learning/article-html'
import { createMediaReadUrl } from '@/lib/aws/storage'
import { courseAnnouncementRepository } from '@/features/learning/course-announcement-repository'
import { courseCommunityRepository } from '@/features/learning/course-community-repository'
import { CourseAnnouncementsPanel } from '@/features/learning/components/course-announcements-panel'
import { CourseCommunityPanel } from '@/features/learning/components/course-community-panel'
import { CourseEditorSteps, type CourseEditorStep } from '@/features/learning/components/course-editor-steps'
import type { MentorMaterialCurriculum } from '@/features/learning/mentor-material-repository'

/** One load per request, shared by the page and its tab title. */
const loadOwnedCourse = cache(async (courseId: string) => {
  const user = await requireAwsUser()
  return { user, course: await courseRepository.getOwnedCourse(user.id, courseId) }
})

function pageHeading(course: MentorOwnedCourseDetail) {
  if (course.revisionOf) return 'Edit published course'
  return canMentorEditCourse(course.status) && !course.revisionClosed ? 'Edit course' : 'View course'
}

/** Round E (E9): the tab title matches the heading ("View course" for a read-only course). */
export async function generateMetadata({ params }: { params: Promise<{ courseId: string }> }): Promise<Metadata> {
  const { courseId } = await params
  const { course } = await loadOwnedCourse(courseId)
  if (!course) return { title: 'Course' }
  return { title: `${pageHeading(course)} · ${course.title}` }
}

/** Round E (E9): the editor's sections, each with ✓ or "needs attention". */
function editorSteps(course: MentorOwnedCourseDetail, curriculum: MentorMaterialCurriculum, extras: { announcements: boolean; community: boolean }): CourseEditorStep[] {
  const detailsDone = Boolean(course.title.trim() && course.description?.trim() && course.learningOutcomes?.some((outcome) => outcome.trim()))
  const pricingDone = course.accessType === 'free' || (course.priceMinor ?? 0) > 0
  const sections = curriculum.sections
  const curriculumDone = sections.length > 0
    && sections.every((section) => section.materials.length > 0)
    && sections.every((section) => section.materials.every((material) => material.materialType !== 'quiz' || (material.quiz?.questions.length ?? 0) > 0))
  const steps: CourseEditorStep[] = [
    { id: 'course-details', label: 'Details', state: detailsDone ? 'done' : 'attention', hint: detailsDone ? undefined : 'Add a title, description and learning outcomes.' },
    { id: 'course-media', label: 'Media', state: course.thumbnailPath ? 'done' : 'attention', hint: course.thumbnailPath ? undefined : 'Add a course thumbnail.' },
    { id: 'course-pricing', label: 'Pricing', state: pricingDone ? 'done' : 'attention', hint: pricingDone ? undefined : 'Set a price for a paid course.' },
    { id: 'course-certificate', label: 'Certificate', state: course.certificateEnabled ? 'done' : 'none', hint: course.certificateEnabled ? undefined : 'Optional: no certificate is issued.' },
    { id: 'course-curriculum', label: 'Curriculum', state: curriculumDone ? 'done' : 'attention', hint: curriculumDone ? undefined : 'Every section needs a material, and every quiz needs questions.' },
  ]
  if (extras.announcements) steps.push({ id: 'course-announcements', label: 'Learners & announcements', state: 'none' })
  if (extras.community) steps.push({ id: 'course-community', label: 'Community', state: 'none' })
  return steps
}

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
      <p className="text-meta font-semibold">
        {label}{reviewedOn ? ` · ${reviewedOn}` : ''}
      </p>
      <p className="mt-1 whitespace-pre-wrap text-sm leading-6">{review.note}</p>
    </div>
  )
}

function RevisionBanner({ course }: { course: MentorOwnedCourseDetail }) {
  const live = course.revisionOf!
  if (course.revisionClosed) {
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-mist-200 bg-mist-50 p-5 text-navy-950">
        <p className="flex items-center gap-2 font-bold">
          <Archive aria-hidden="true" className="size-5 shrink-0" /> These changes are closed
        </p>
        <p className="mt-1 text-sm leading-6 text-muted">
          They were either approved and applied to the live course, or discarded. This copy is kept as a record and can’t be edited.
        </p>
        <Link href={`/learn/studio/courses/${live.courseId}/edit`} className="mt-3 inline-flex text-sm font-bold text-ocean-700 underline-offset-2 hover:underline">Go to the live course</Link>
      </section>
    )
  }
  if (course.status === 'submitted') {
    const submittedOn = formatDate(course.submittedAt)
    return (
      <section aria-label="Review status" className="mt-5 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950">
        <p className="flex items-center gap-2 font-bold">
          <Clock3 aria-hidden="true" className="size-5 shrink-0" /> Changes in review{submittedOn ? ` · submitted ${submittedOn}` : ''}
        </p>
        <p className="mt-1 text-sm leading-6">
          Learners keep the live version while Sea N Shore reviews your changes. When they’re approved, they replace it and every learner’s progress carries over. To change something, withdraw them from review first.
        </p>
        {course.lastReview?.decision === 'changes_requested' ? <ReviewerNote course={course} label="Feedback from the last review" /> : null}
        <Link href={`/learn/studio/courses/${course.id}/changes`} className="mt-3 inline-flex text-sm font-bold text-ocean-700 underline-offset-2 hover:underline">See what changed, side by side</Link>
        <CourseWithdrawControl courseId={course.id} />
      </section>
    )
  }
  const requested = course.status === 'changes_requested'
  return (
    <section aria-label="Review status" className={`mt-5 rounded-2xl border p-5 ${requested ? 'border-amber-200 bg-amber-50 text-amber-950' : 'border-teal-200 bg-teal-50 text-navy-950'}`}>
      <p className="flex items-center gap-2 font-bold">
        {requested
          ? <><AlertTriangle aria-hidden="true" className="size-5 shrink-0" /> Changes requested by Sea N Shore review</>
          : <><FilePenLine aria-hidden="true" className="size-5 shrink-0" /> Editing a draft copy of your published course</>}
      </p>
      <p className="mt-1 text-sm leading-6">
        Learners keep seeing the live version until Sea N Shore approves these changes. Save as you go, then submit them for review.
      </p>
      {requested ? <ReviewerNote course={course} /> : null}
      <Link href={`/learn/studio/courses/${course.id}/changes`} className="mt-3 inline-flex text-sm font-bold text-ocean-700 underline-offset-2 hover:underline">See what changed, side by side</Link>
      <CourseRevisionDiscardControl revisionCourseId={course.id} liveCourseId={live.courseId} />
    </section>
  )
}

function StatusBanner({ course }: { course: MentorOwnedCourseDetail }) {
  if (course.revisionOf) return <RevisionBanner course={course} />
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
            <p className="text-meta font-semibold">Reviewer note</p>
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
        <p className="mt-1 text-sm leading-6 text-muted">
          This course is off the catalogue and closed to new learners. Learners already enrolled keep full access, including their certificates. Sea N Shore can return it to the catalogue.
        </p>
      </section>
    )
  }

  return (
    <section aria-label="Review status" className="mt-5 rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-emerald-950">
      <p className="flex items-center gap-2 font-bold">
        <BadgeCheck aria-hidden="true" className="size-5 shrink-0" /> Published · live
      </p>
      <p className="mt-1 text-sm leading-6">
        {course.openRevision
          ? 'You have changes to this course in progress. Learners keep this version until Sea N Shore approves them.'
          : 'Learners see this version. To change it, edit a draft copy: learners keep this version until Sea N Shore approves your changes, and their progress carries over.'}
      </p>
      {course.lastReview?.note ? <ReviewerNote course={course} /> : null}
      <CourseRevisionStartControl courseId={course.id} openRevision={course.openRevision ?? null} />
    </section>
  )
}

export default async function EditMentorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  const { user, course } = await loadOwnedCourse(courseId)
  if (!course) return notFound()

  const [curriculum, sellerFee, plans] = await Promise.all([
    mentorMaterialRepository.getCurriculum(user.id, courseId),
    // The seller is the course's organization, or the trainer who owns a personal course.
    loadSellerFeeTerms(course.companyId ? { companyId: course.companyId } : { profileId: user.id }),
    // Round C (C3): the plans this draft sells.
    coursePlanRepository.list(course.id).catch(() => []),
  ])
  if (!curriculum) return notFound()
  // Article images are stored by path; the editor shows them through short-lived signed URLs.
  const editableCurriculum = {
    ...curriculum,
    sections: await Promise.all(curriculum.sections.map(async (section) => ({
      ...section,
      materials: await Promise.all(section.materials.map(async (material) => (
        material.articleFormat === 'html' && material.articleBody?.includes(ARTICLE_IMAGE_PATH_ATTRIBUTE)
          ? { ...material, articleBody: await renderArticleHtml(material.articleBody, (path) => createMediaReadUrl(path)) }
          : material
      ))),
    }))),
  }

  const isRevision = Boolean(course.revisionOf)
  const editable = canMentorEditCourse(course.status) && !course.revisionClosed
  // Learning round C: announcements and the course community belong to the live course (a draft revision's
  // edit page works on the course it revises). Announcements need a course learners can be enrolled in.
  const liveCourseId = course.revisionOf?.courseId ?? course.id
  const liveCourseHasLearners = isRevision || course.status === 'published' || course.status === 'archived'
  const [announcementData, communityLink] = course.revisionClosed
    ? [null, null]
    : await Promise.all([
      liveCourseHasLearners ? courseAnnouncementRepository.listForManager(user.id, liveCourseId).catch(() => null) : Promise.resolve(null),
      courseCommunityRepository.getLinkForManager(user.id, liveCourseId).catch(() => null),
    ])

  const heading = pageHeading(course)
  const steps = editorSteps(course, curriculum, { announcements: Boolean(announcementData), community: Boolean(communityLink) })

  const initialValue: CourseDraftInput = {
    // A draft copy shows (and keeps) the live course's address.
    slug: course.revisionOf?.slug ?? course.slug,
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
    <div className="mx-auto w-full max-w-page-wide py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio" title={heading} />
      <WorksBestOnComputer>The course editor and SCORM upload work best on a computer. Everything still works here.</WorksBestOnComputer>
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" /> Learning Studio
      </Link>

      <CourseEditSession initialDetailsRevision={course.detailsRevision} saveBar={editable}>
        <section className="mt-5 rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
          <h1 className="text-page-title font-bold text-navy-950">{heading}</h1>
          <p className="mt-1 inline-flex items-center gap-2 text-meta font-semibold text-teal-800">
            <FilePenLine aria-hidden="true" className="size-4" /> {isRevision ? 'Changes to a published course' : editable ? 'Private course draft' : 'Read-only'}
          </p>
          <p className="mt-2 break-words text-lg font-semibold text-navy-900">{course.title}</p>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
            {isRevision
              ? 'Change anything below: details, sections, materials, quizzes or price. Learners keep the live version until your changes are approved. A new price applies to new purchases only.'
              : editable
                ? 'Refine the course foundation and curriculum, save your changes, then submit it for Sea N Shore review. Learners cannot access this course while it remains editable in Learning Studio.'
                : 'You can review everything in this course below. Fields are locked in its current status.'}
          </p>
        </section>

        <StatusBanner course={course} />

        <div className="mt-5 grid gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start">
        <CourseEditorSteps steps={steps} />
        <div className="min-w-0">
        <div>
          <CourseForm
            key={course.id}
            initialValue={initialValue}
            courseId={course.id}
            publisherName={course.publisherName}
            readOnly={!editable}
            slugLocked={isRevision}
            sellerFees={{ default: sellerFee }}
          />
        </div>

        <div className="mt-5">
          <CoursePricingPlansPanel courseId={course.id} paid={course.accessType === 'paid'} plans={plans} readOnly={!editable} />
        </div>

        <div id="course-certificate" className="mt-5 scroll-mt-24">
          <CertificateSettingsPanel
            courseId={course.id}
            initial={course.certificate ?? DEFAULT_CERTIFICATE_SETTINGS}
            certificateEnabled={course.certificateEnabled}
            quizzes={curriculum.sections.flatMap((section) => section.materials.filter((material) => material.materialType === 'quiz').map((material) => ({ id: material.id, title: material.title })))}
            readOnly={!editable}
          />
        </div>

        <div id="course-curriculum" className="mt-5 scroll-mt-24">
          <MentorCurriculumEditor courseId={course.id} curriculum={editableCurriculum} readOnly={!editable} />
        </div>

        {editable ? (
          <div className="mt-5">
            <CourseSubmitControl
              courseId={course.id}
              revision={isRevision}
              resubmission={course.status === 'changes_requested' || course.lastReview?.decision === 'changes_requested'}
            />
          </div>
        ) : null}

        {announcementData || communityLink ? (
          <div className="mt-5 space-y-5">
            {announcementData ? <div id="course-announcements" className="scroll-mt-24"><CourseAnnouncementsPanel data={announcementData} /></div> : null}
            {communityLink ? <div id="course-community" className="scroll-mt-24"><CourseCommunityPanel link={communityLink} /></div> : null}
          </div>
        ) : null}
        </div>
        </div>
      </CourseEditSession>
    </div>
  )
}
