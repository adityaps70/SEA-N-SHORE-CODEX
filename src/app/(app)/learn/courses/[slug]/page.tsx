import type { Metadata } from 'next'
import { cache } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Globe2,
  GraduationCap,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { EnrollFreeControl } from '@/features/learning/components/enroll-free-control'
import { enrollmentRepository } from '@/features/learning/enrollment-repository'
import { marketplaceRepository, type MarketplaceCourse } from '@/features/learning/marketplace-repository'

type PublishedCoursePageProps = {
  params: Promise<{ slug: string }>
}

function levelLabel(level: MarketplaceCourse['level']) {
  if (level === 'all_levels') return 'All levels'
  return `${level.charAt(0).toUpperCase()}${level.slice(1)}`
}

function formatLabel(format: MarketplaceCourse['courseFormat']) {
  if (format === 'live_cohort') return 'Live cohort'
  if (format === 'hybrid') return 'Hybrid'
  return 'Recorded'
}

function pricingLabel(course: MarketplaceCourse) {
  if (course.accessType === 'free' || course.priceMinor === 0) return 'Free'
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: course.currency,
    maximumFractionDigits: 0,
  }).format(course.priceMinor / 100)
}

function EvidenceList({ items }: { items: string[] }) {
  if (!items.length) {
    return <p className="text-sm leading-6 text-muted">No additional prerequisites have been specified for this course.</p>
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-sm leading-6 text-navy-950">
          <CheckCircle2 aria-hidden="true" className="mt-1 size-4 shrink-0 text-teal-700" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  )
}

const loadPublishedCourse = cache((slug: string) => marketplaceRepository.getPublishedCourseBySlug(slug))

export async function generateMetadata({ params }: PublishedCoursePageProps): Promise<Metadata> {
  const { slug } = await params
  const course = await loadPublishedCourse(slug)
  if (!course) return { title: 'Course not found' }
  return { title: course.title, description: course.subtitle ?? undefined }
}

export default async function PublishedCoursePage({ params }: PublishedCoursePageProps) {
  const { slug } = await params
  const course = await loadPublishedCourse(slug)

  if (!course) return notFound()

  const user = await requireAwsUser()
  const enrollment = await enrollmentRepository.getLearnerEnrollment(user.id, course.id)
  const initiallyEnrolled = enrollment?.status === 'active' || enrollment?.status === 'completed'
  const isFree = course.accessType === 'free' || course.priceMinor === 0

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <Link
        href="/learn"
        className="inline-flex items-center gap-2 text-sm font-bold text-teal-800 transition hover:text-teal-700"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Explore courses
      </Link>

      <section className="mt-4 overflow-hidden rounded-[1.9rem] bg-navy-950 text-white shadow-[var(--shadow-card)]">
        <div className="grid lg:grid-cols-[1.45fr_0.55fr]">
          <div className="p-6 sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-teal-100">
                <BookOpen aria-hidden="true" className="size-3.5" /> {course.category}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/80">
                {levelLabel(course.level)}
              </span>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-white/80">
                {formatLabel(course.courseFormat)}
              </span>
            </div>

            <p className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-teal-200">
              <Sparkles aria-hidden="true" className="size-4" /> Sea N Shore Learning
            </p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {course.title}
            </h1>
            {course.subtitle ? (
              <p className="mt-4 max-w-3xl text-base font-medium leading-7 text-white/78 sm:text-lg">{course.subtitle}</p>
            ) : null}
            <p className="mt-5 max-w-3xl text-sm leading-7 text-white/66 sm:text-base">{course.description}</p>

            <div className="mt-7 flex flex-wrap gap-2 text-xs font-bold text-white/82">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <Globe2 aria-hidden="true" className="size-3.5 text-teal-200" /> {course.language}
              </span>
              {course.certificateEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                  <Award aria-hidden="true" className="size-3.5 text-teal-200" /> Certificate
                </span>
              ) : null}
            </div>
          </div>

          <aside className="border-t border-white/10 bg-white/[0.055] p-6 sm:p-8 lg:border-l lg:border-t-0 lg:p-8">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-200">Course access</p>
            <p className="mt-2 text-3xl font-extrabold tracking-tight">{pricingLabel(course)}</p>
            <p className="mt-2 text-sm leading-6 text-white/65">
              {isFree
                ? 'Learning access is free for signed-in Sea N Shore members. Enroll with your existing account.'
                : 'Paid enrollment is not available yet.'}
            </p>

            {isFree ? (
              <div className="mt-6">
                <EnrollFreeControl courseId={course.id} initiallyEnrolled={initiallyEnrolled} />
              </div>
            ) : null}

            <div className="mt-6 rounded-[1.3rem] border border-white/10 bg-navy-950/45 p-4">
              <div className="flex items-center gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-white text-sm font-extrabold text-navy-950">
                  {course.mentorName.charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-white">{course.mentorName}</p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-bold text-teal-200">
                    <BadgeCheck aria-hidden="true" className="size-3.5" /> Verified trainer
                  </p>
                </div>
              </div>
              <p className="mt-4 flex gap-2 text-xs leading-5 text-white/62">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-teal-200" />
                Trainer credentials and this course were reviewed before publication on Sea N Shore.
              </p>
            </div>
          </aside>
        </div>
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <section
          aria-label="What you will learn"
          className="rounded-[1.5rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-7"
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Learning outcomes</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">What you will learn</h2>
          <div className="mt-5">
            <EvidenceList items={course.learningOutcomes} />
          </div>
        </section>

        <section
          aria-label="Who this course is for"
          className="rounded-[1.5rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-7"
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Intended learners</p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-navy-950">
            <Users aria-hidden="true" className="size-5 text-teal-700" /> Who this course is for
          </h2>
          <div className="mt-5">
            <EvidenceList items={course.targetAudience} />
          </div>
        </section>

        <section
          aria-label="Requirements"
          className="rounded-[1.5rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-7"
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Before you begin</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">Requirements</h2>
          <div className="mt-5">
            <EvidenceList items={course.requirements} />
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-mist-100 bg-mist-50/70 p-6 sm:p-7">
          <span className="grid size-11 place-items-center rounded-2xl bg-navy-950 text-white">
            <GraduationCap aria-hidden="true" className="size-5" />
          </span>
          <p className="mt-4 text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Quality standard</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">Built for professional maritime development</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Published courses pass through Sea N Shore review so the marketplace stays focused on credible, role-relevant maritime learning.
          </p>
        </section>
      </div>
    </main>
  )
}