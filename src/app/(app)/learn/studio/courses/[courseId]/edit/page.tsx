import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { AlertTriangle, ArrowLeft, FilePenLine } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseForm } from '@/features/learning/components/course-form'
import { CourseSubmitControl } from '@/features/learning/components/course-submit-control'
import { MentorCurriculumEditor } from '@/features/learning/components/mentor-curriculum-editor'
import { courseRepository, type CourseDraftInput } from '@/features/learning/course-repository'
import { mentorMaterialRepository } from '@/features/learning/mentor-material-repository'
import { learningRepository } from '@/features/learning/repository'

export default async function EditMentorCoursePage({
  params,
}: {
  params: Promise<{ courseId: string }>
}) {
  const { courseId } = await params
  const user = await requireAwsUser()
  const mentorState = await learningRepository.getMentorApplicationState(user.id)

  if (mentorState.kind !== 'mentor' || mentorState.mentorStatus !== 'active') {
    return redirect('/learn/teach')
  }

  const course = await courseRepository.getOwnedCourse(user.id, courseId)
  if (!course) return notFound()

  if (course.status !== 'draft' && course.status !== 'changes_requested') {
    return redirect('/learn/studio')
  }

  const curriculum = await mentorMaterialRepository.getCurriculum(user.id, courseId)
  if (!curriculum) return notFound()

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
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-navy-950">
        <ArrowLeft aria-hidden="true" className="size-4" /> Mentor Studio
      </Link>

      <section className="mt-5 rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
          <FilePenLine aria-hidden="true" className="size-4" /> Private mentor draft
        </p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">Edit course</h1>
        <p className="mt-2 text-lg font-semibold text-navy-900">{course.title}</p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Refine the course foundation and curriculum before submitting it for Sea N Shore review. Learners cannot access this course while it remains editable in Mentor Studio.
        </p>
      </section>

      {course.status === 'changes_requested' && course.adminReviewNote ? (
        <section className="mt-5 flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <p className="font-bold">Sea N Shore review feedback</p>
            <p className="mt-1 text-sm leading-6">{course.adminReviewNote}</p>
          </div>
        </section>
      ) : null}

      <div className="mt-5">
        <CourseForm initialValue={initialValue} courseId={course.id} />
      </div>

      <div className="mt-5">
        <MentorCurriculumEditor courseId={course.id} curriculum={curriculum} />
      </div>

      <div className="mt-5">
        <CourseSubmitControl courseId={course.id} />
      </div>
    </main>
  )
}
