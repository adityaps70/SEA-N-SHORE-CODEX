import type { Metadata } from 'next'
import { cache } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ArrowLeft,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  Clock3,
  Globe2,
  GraduationCap,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CourseActionBar, type CourseActionBarMode } from '@/features/learning/components/course-action-bar'
import { PageActionsSheet } from '@/features/learning/components/page-actions-sheet'
import { EnrollFreeControl } from '@/features/learning/components/enroll-free-control'
import { CoursePurchasePanel, type CoursePurchaseState } from '@/features/learning/components/course-purchase-panel'
import { coursePrice, discountPercent, formatCourseAmount, isPaidCourse } from '@/features/learning/course-pricing'
import { loadCoursePurchaseState } from '@/features/learning/course-purchase-state'
import { enrollmentRepository } from '@/features/learning/enrollment-repository'
import { marketplaceRepository, type MarketplaceCourse, type PublishedCourseOverview } from '@/features/learning/marketplace-repository'
import { splitDescription } from '@/features/learning/description'

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

function PriceBlock({ course }: { course: MarketplaceCourse }) {
  if (!isPaidCourse(course)) return <p className="mt-2 text-3xl font-extrabold tracking-tight">Free</p>
  const price = coursePrice(course)
  if (!price) return <p className="mt-2 text-3xl font-extrabold tracking-tight">{formatCourseAmount(course.priceMinor, course.currency)}</p>
  if (price.discountPriceMinor === null) {
    return <p className="mt-2 text-3xl font-extrabold tracking-tight">{formatCourseAmount(price.amountMinor, price.currency)}</p>
  }
  return (
    <div className="mt-2">
      <p className="text-3xl font-extrabold tracking-tight">
        <span className="sr-only">Now </span>{formatCourseAmount(price.amountMinor, price.currency)}
      </p>
      <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
        <span className="text-white/60 line-through decoration-white/60">
          <span className="sr-only">Was </span>{formatCourseAmount(price.listPriceMinor, price.currency)}
        </span>
        <span className="rounded-full bg-teal-400/15 px-2.5 py-0.5 text-xs font-bold text-teal-100">Save {discountPercent(price)}%</span>
      </p>
    </div>
  )
}

/** Card on desktop; a flat full-width white band on phones. */
const PHONE_FLAT_SECTION = 'rounded-[1.5rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:p-4 max-md:shadow-none sm:p-7'

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

function CourseDescription({ text }: { text: string }) {
  const [intro, rest] = splitDescription(text)
  return (
    <div className="mt-5 max-w-3xl space-y-2 text-sm leading-7 text-white/66 sm:text-base">
      <p>{intro}</p>
      {rest ? (
        <details className="group">
          <summary className="cursor-pointer list-none text-sm font-bold text-teal-200 transition hover:text-white group-open:hidden">
            Read the full description
          </summary>
          <p>{rest}</p>
        </details>
      ) : null}
    </div>
  )
}

function durationLabel(seconds: number) {
  if (seconds <= 0) return null
  if (seconds >= 3600) {
    const hours = Math.round(seconds / 1800) / 2
    return `${hours} h`
  }
  return `${Math.max(1, Math.round(seconds / 60))} min`
}

function priceChipLabel(course: MarketplaceCourse) {
  if (!isPaidCourse(course)) return 'Free'
  const price = coursePrice(course)
  return price ? formatCourseAmount(price.amountMinor, price.currency) : formatCourseAmount(course.priceMinor, course.currency)
}

function actionBarMode(isFree: boolean, initiallyEnrolled: boolean, purchase: CoursePurchaseState | null, completed: boolean): CourseActionBarMode | null {
  if (isFree) return initiallyEnrolled ? { kind: 'continue', label: completed ? 'Review course' : 'Continue learning' } : { kind: 'enroll' }
  if (!purchase) return null
  if (purchase.kind === 'enrolled') return { kind: 'continue', label: purchase.completed ? 'Review course' : 'Continue learning' }
  if (purchase.kind === 'buy' && purchase.configured && !purchase.blockedMessage) return { kind: 'buy', priceLabel: purchase.priceLabel }
  return null
}

const EMPTY_OVERVIEW: PublishedCourseOverview = { sections: [], lessonCount: 0, durationSeconds: 0, learnerCount: 0, publisher: null }

/** Phone course header (round 8): cover, chips, title, trainer link and learners. */
function PhoneCourseHeader({ course, overview }: { course: MarketplaceCourse; overview: PublishedCourseOverview }) {
  const duration = durationLabel(overview.durationSeconds)
  const publisherHref = overview.publisher
    ? overview.publisher.kind === 'organization' ? `/organizations/${overview.publisher.slug}` : `/people/${overview.publisher.slug}`
    : null
  const [intro, rest] = splitDescription(course.description, 220)
  return (
    <div data-testid="phone-course-header" className="-mx-4 -mt-3 bg-white md:hidden max-md:order-1">
      <div className="relative aspect-[16/9] overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800">
        {course.thumbnailPath ? (
          <Image
            unoptimized
            fill
            priority
            sizes="100vw"
            src={`/api/learning-media/${course.thumbnailPath}`}
            alt={`${course.title} course cover`}
            className="object-cover"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center text-teal-200">
            <BookOpen aria-hidden="true" className="size-10" />
          </span>
        )}
      </div>
      <div className="px-4 pb-4 pt-4">
        <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
          <span className="rounded-full bg-teal-50 px-3 py-1 text-teal-800">{priceChipLabel(course)}</span>
          {course.certificateEnabled ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-100 px-3 py-1 text-navy-900">
              <Award aria-hidden="true" className="size-4" /> Certificate
            </span>
          ) : null}
          {duration ? (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mist-100 px-3 py-1 text-navy-900">
              <Clock3 aria-hidden="true" className="size-4" /> {duration}
            </span>
          ) : null}
        </div>
        <h1 className="mt-3 text-[22px] font-bold leading-7 tracking-tight text-navy-950">{course.title}</h1>
        <p className="mt-1.5 text-[15px] text-navy-900">
          By{' '}
          {publisherHref ? (
            <Link href={publisherHref} className="font-semibold text-ocean-700 hover:underline">{course.mentorName}</Link>
          ) : (
            <span className="font-semibold">{course.mentorName}</span>
          )}
          <span aria-hidden="true"> · </span>
          <span className="text-muted">{overview.publisher?.kind === 'organization' ? 'Verified organization' : 'Verified trainer'}</span>
        </p>
        {overview.learnerCount > 0 ? (
          <p className="mt-1 text-sm text-muted">
            <Users aria-hidden="true" className="mr-1 inline size-4 align-[-3px]" />
            {overview.learnerCount.toLocaleString('en-IN')} {overview.learnerCount === 1 ? 'learner' : 'learners'}
          </p>
        ) : null}
        {course.subtitle ? <p className="mt-3 text-[15px] leading-6 text-navy-900">{course.subtitle}</p> : null}
        {rest || intro.length > 140 ? (
          <details className="group mt-2 text-sm leading-6 text-muted">
            <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
              <span className="line-clamp-2 group-open:line-clamp-none">{intro}</span>
              <span className="font-semibold text-navy-700 group-open:hidden">more</span>
            </summary>
            {rest ? <p className="mt-2">{rest}</p> : null}
          </details>
        ) : (
          <p className="mt-2 text-sm leading-6 text-muted">{intro}</p>
        )}
      </div>
    </div>
  )
}

/** Phone curriculum summary: section names with published lesson counts (no lesson content). */
function PhoneCurriculumSummary({ overview }: { overview: PublishedCourseOverview }) {
  if (!overview.lessonCount) return null
  return (
    <section aria-label="Curriculum" className="-mx-4 bg-white px-4 py-4 md:hidden">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-bold text-navy-950">Curriculum</h2>
        <p className="text-sm font-semibold text-ocean-700">{overview.lessonCount} {overview.lessonCount === 1 ? 'lesson' : 'lessons'}</p>
      </div>
      <ol className="mt-2 divide-y divide-mist-100">
        {overview.sections.map((section, index) => (
          <li key={`${index}-${section.title}`} className="flex min-h-12 items-center justify-between gap-3 py-2 text-[15px]">
            <span className="min-w-0 text-navy-950">{index + 1}. {section.title}</span>
            <span className="shrink-0 text-sm text-muted">{section.lessonCount} {section.lessonCount === 1 ? 'lesson' : 'lessons'}</span>
          </li>
        ))}
      </ol>
    </section>
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
  const [enrollment, overview] = await Promise.all([
    enrollmentRepository.getLearnerEnrollment(user.id, course.id),
    // The phone summary is a convenience: the course page must still render without it.
    marketplaceRepository.getPublishedCourseOverview(course.id).catch(() => EMPTY_OVERVIEW),
  ])
  const initiallyEnrolled = enrollment?.status === 'active' || enrollment?.status === 'completed'
  const isFree = !isPaidCourse(course)
  const purchase: CoursePurchaseState | null = isFree ? null : await loadCoursePurchaseState({ userId: user.id, course, enrollment })
  const barMode = actionBarMode(isFree, initiallyEnrolled, purchase, enrollment?.status === 'completed')
  const coursePath = `/learn/courses/${course.slug}`

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 max-md:flex max-md:flex-col max-md:px-0 max-md:py-0 sm:px-6 lg:px-8">
      <MobilePageBar
        backHref="/learn"
        className="max-md:order-first"
        right={(
          <PageActionsSheet
            label="More course actions"
            actions={[
              { kind: 'share', url: coursePath, title: course.title },
              { kind: 'copy', url: coursePath },
              { kind: 'link', href: '/learn/my-learning', label: 'My learning', icon: <GraduationCap aria-hidden="true" /> },
            ]}
          />
        )}
      />
      <Link
        href="/learn"
        className="inline-flex items-center gap-2 text-sm font-bold text-teal-800 transition hover:text-teal-700 max-md:hidden"
      >
        <ArrowLeft aria-hidden="true" className="size-4" /> Explore courses
      </Link>

      <PhoneCourseHeader course={course} overview={overview} />

      <section id="course-access" className="mt-4 scroll-mt-20 overflow-hidden rounded-[1.9rem] bg-navy-950 text-white shadow-[var(--shadow-card)] max-md:order-3 max-md:rounded-2xl">
        <div className="grid lg:grid-cols-[1.45fr_0.55fr]">
          <div className="p-6 max-md:hidden sm:p-8 lg:p-10">
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-teal-100">
                <BookOpen aria-hidden="true" className="size-3.5" /> {course.category}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">
                {levelLabel(course.level)}
              </span>
              <span className="rounded-full bg-white/10 px-3 py-1 text-white/80">
                {formatLabel(course.courseFormat)}
              </span>
            </div>

            <p className="mt-6 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.17em] text-teal-200">
              Sea N Shore Learning
            </p>
            <h1 className="mt-3 max-w-4xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              {course.title}
            </h1>
            {course.subtitle ? (
              <p className="mt-4 max-w-3xl text-base font-medium leading-7 text-white/78 sm:text-lg">{course.subtitle}</p>
            ) : null}
            <CourseDescription text={course.description} />

            <div className="mt-7 flex flex-wrap gap-2 text-xs font-bold text-white/82">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                <Globe2 aria-hidden="true" className="size-3.5 text-teal-200" /> {course.language}
              </span>
              {course.certificateEnabled ? (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1">
                  <Award aria-hidden="true" className="size-3.5 text-teal-200" /> Certificate
                </span>
              ) : null}
            </div>
          </div>

          <aside className="border-t border-white/10 bg-white/[0.055] p-6 max-md:border-t-0 max-md:p-5 sm:p-8 lg:border-l lg:border-t-0 lg:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-200">Course access</p>
            <PriceBlock course={course} />
            <p className="mt-2 text-sm leading-6 text-white/65">
              {isFree
                ? 'Learning access is free for signed-in Sea N Shore members. Enroll with your existing account.'
                : 'One-time payment for your Sea N Shore account. The course unlocks as soon as your payment is confirmed.'}
            </p>

            {isFree ? (
              <div className="mt-6">
                {/* Remounts after the phone bar enrolls and the page refreshes. */}
                <EnrollFreeControl key={initiallyEnrolled ? 'enrolled' : 'open'} courseId={course.id} initiallyEnrolled={initiallyEnrolled} />
              </div>
            ) : purchase ? (
              <div className="mt-6">
                <CoursePurchasePanel course={{ id: course.id, slug: course.slug, title: course.title }} state={purchase} />
              </div>
            ) : null}

            {/* Phones show the trainer in the course header instead. */}
            <div className="mt-6 rounded-[1.3rem] border border-white/10 bg-navy-950/45 p-4 max-md:hidden">
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

      <div className="mt-6 grid gap-6 max-md:order-2 max-md:mt-2 max-md:gap-2 lg:grid-cols-[1.15fr_0.85fr]">
        <section
          aria-label="What you will learn"
          className={PHONE_FLAT_SECTION}
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 max-md:hidden">Learning outcomes</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 max-md:mt-0 max-md:text-lg">What you will learn</h2>
          <div className="mt-5 max-md:mt-3">
            <EvidenceList items={course.learningOutcomes} />
          </div>
        </section>

        <PhoneCurriculumSummary overview={overview} />

        <section
          aria-label="Who this course is for"
          className={PHONE_FLAT_SECTION}
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 max-md:hidden">Intended learners</p>
          <h2 className="mt-1 flex items-center gap-2 text-2xl font-bold tracking-tight text-navy-950 max-md:mt-0 max-md:text-lg">
            <Users aria-hidden="true" className="size-5 text-teal-700" /> Who this course is for
          </h2>
          <div className="mt-5">
            <EvidenceList items={course.targetAudience} />
          </div>
        </section>

        <section
          aria-label="Requirements"
          className={PHONE_FLAT_SECTION}
        >
          <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700 max-md:hidden">Before you begin</p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950 max-md:mt-0 max-md:text-lg">Requirements</h2>
          <div className="mt-5">
            <EvidenceList items={course.requirements} />
          </div>
        </section>

        <section className="rounded-[1.5rem] border border-mist-100 bg-mist-50/70 p-6 max-md:hidden sm:p-7">
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

      {barMode ? <CourseActionBar course={{ id: course.id, slug: course.slug, title: course.title }} mode={barMode} /> : null}
    </main>
  )
}