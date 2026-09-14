import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, BookOpen, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseForm } from '@/features/learning/components/course-form'
import type { CourseDraftInput } from '@/features/learning/course-repository'
import { learningRepository } from '@/features/learning/repository'

const initialCourse: CourseDraftInput = {
  slug: '',
  title: '',
  subtitle: null,
  description: '',
  category: 'Deck',
  level: 'beginner',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: [],
  requirements: [],
  targetAudience: [],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: false,
  courseFormat: 'recorded',
}

export default async function NewMentorCoursePage() {
  const user = await requireAwsUser()
  const mentorState = await learningRepository.getMentorApplicationState(user.id)

  if (mentorState.kind !== 'mentor' || mentorState.mentorStatus !== 'active') {
    return redirect('/learn/teach')
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-navy-950">
        <ArrowLeft aria-hidden="true" className="size-4" /> Mentor Studio
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.75rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <BookOpen aria-hidden="true" className="size-4" /> Mentor course builder
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Create course</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Start with a focused maritime outcome, define who the course is for and save a private draft. Curriculum sections and lessons can be organized after the course foundation is created.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/75">
            <p className="inline-flex items-center gap-2 font-bold text-white">
              <ShieldCheck aria-hidden="true" className="size-4" /> Reviewed before publication
            </p>
            <p className="mt-1">Creating a draft does not publish it. Sea N Shore quality review remains required before learners can access the course.</p>
          </div>
        </div>
      </section>

      <div className="mt-5">
        <CourseForm initialValue={initialCourse} />
      </div>
    </main>
  )
}
