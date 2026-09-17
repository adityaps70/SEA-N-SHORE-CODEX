import Image from 'next/image'
import Link from 'next/link'
import {
  ArrowRight,
  Award,
  BadgeCheck,
  BookOpen,
  CheckCircle2,
  GraduationCap,
  Search,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { marketplaceRepository, type MarketplaceCourse } from '@/features/learning/marketplace-repository'
import { learningRepository } from '@/features/learning/repository'

const categories = [
  'Deck',
  'Engine',
  'Tankers',
  'LNG/LPG',
  'Offshore',
  'SIRE 2.0',
  'Safety',
  'Maritime Law',
  'Leadership',
  'Human Factors',
  'Shore Careers',
  'Mental Health',
  'Exams & Assessments',
] as const

type LearnSearchParams = {
  category?: string | string[]
  search?: string | string[]
}

type LearnPageProps = {
  searchParams: Promise<LearnSearchParams>
}

function normalizeParam(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value
  return first?.trim() || null
}

function categoryHref(category: string, search: string | null) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  params.set('category', category)
  return `/learn?${params.toString()}`
}

function allCoursesHref(search: string | null) {
  if (!search) return '/learn'
  const params = new URLSearchParams({ search })
  return `/learn?${params.toString()}`
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

function CourseCard({ course }: { course: MarketplaceCourse }) {
  const firstOutcome = course.learningOutcomes[0] ?? null
  const thumbnailPath = course.thumbnailPath

  return (
    <article className="group overflow-hidden rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)] transition duration-200 hover:-translate-y-0.5 hover:border-teal-200">
      <div className="relative min-h-44 overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-5 text-white">
        {thumbnailPath ? (
          <>
            <Image
              unoptimized
              fill
              sizes="(min-width: 1280px) 33vw, (min-width: 768px) 50vw, 100vw"
              src={`/api/learning-media/${thumbnailPath}`}
              alt={`${course.title} course cover`}
              className="object-cover transition duration-300 group-hover:scale-[1.02]"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-navy-950 via-navy-950/55 to-navy-950/20" />
          </>
        ) : (
          <>
            <div className="absolute -right-10 -top-14 size-40 rounded-full border border-white/10 bg-white/5" />
            <div className="absolute -bottom-16 -left-8 size-36 rounded-full border border-teal-200/15 bg-teal-300/5" />
          </>
        )}
        <div className="relative flex min-h-36 flex-col justify-between gap-8">
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-navy-950/55 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
              <BookOpen aria-hidden="true" className="size-3.5" /> {course.category}
            </span>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-navy-950">
              {pricingLabel(course)}
            </span>
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-200">Sea N Shore Learning</p>
            <p className="mt-1 text-sm font-medium text-white/85">Practical maritime learning from verified professionals</p>
          </div>
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-muted">
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{levelLabel(course.level)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{formatLabel(course.courseFormat)}</span>
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{course.language}</span>
          {course.certificateEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-800">
              <Award aria-hidden="true" className="size-3.5" /> Certificate
            </span>
          ) : null}
        </div>

        <Link
          href={`/learn/courses/${course.slug}`}
          className="mt-4 inline-flex items-start gap-2 text-xl font-bold tracking-tight text-navy-950 transition group-hover:text-teal-800"
        >
          {course.title}
          <ArrowRight aria-hidden="true" className="mt-1 size-4 shrink-0" />
        </Link>
        {course.subtitle ? <p className="mt-2 text-sm leading-6 text-muted">{course.subtitle}</p> : null}

        <div className="mt-4 flex items-center gap-2 border-t border-mist-100 pt-4">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-navy-950 text-xs font-extrabold text-white">
            {course.mentorName.charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-navy-950">{course.mentorName}</p>
            <p className="mt-0.5 inline-flex items-center gap-1 text-xs font-bold text-teal-800">
              <BadgeCheck aria-hidden="true" className="size-3.5" /> Verified mentor
            </p>
          </div>
        </div>

        {firstOutcome ? (
          <div className="mt-4 rounded-xl border border-mist-100 bg-mist-50/70 p-3">
            <p className="text-[11px] font-extrabold uppercase tracking-[0.12em] text-muted">You&apos;ll learn</p>
            <p className="mt-1.5 text-sm font-semibold leading-6 text-navy-950">{firstOutcome}</p>
          </div>
        ) : null}

        <Link
          href={`/learn/courses/${course.slug}`}
          className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900"
        >
          View course <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </article>
  )
}

export default async function LearnPage({ searchParams }: LearnPageProps) {
  const params = await searchParams
  const category = normalizeParam(params.category)
  const search = normalizeParam(params.search)
  const user = await requireAwsUser()
  const [courses, mentorState] = await Promise.all([
    marketplaceRepository.listPublishedCourses({ category, search }),
    learningRepository.getMentorApplicationState(user.id),
  ])
  const isActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasFilters = Boolean(category || search)

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="overflow-hidden rounded-[1.9rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8 lg:p-10">
        <div className="grid gap-8 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <Sparkles aria-hidden="true" className="size-4" /> Sea N Shore Learning
            </p>
            <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
              Learn from verified maritime professionals.
            </h1>
            <p className="mt-4 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Build practical maritime skills with courses reviewed by Sea N Shore and taught by professionals whose industry experience has been verified.
            </p>
            <div className="mt-5 flex flex-wrap gap-2 text-xs font-bold text-white/80">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <ShieldCheck aria-hidden="true" className="size-3.5 text-teal-200" /> Verified mentors
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <CheckCircle2 aria-hidden="true" className="size-3.5 text-teal-200" /> Reviewed before publishing
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5">
                <GraduationCap aria-hidden="true" className="size-3.5 text-teal-200" /> Career-relevant learning
              </span>
            </div>
          </div>

          <div className="rounded-[1.4rem] border border-white/10 bg-white/5 p-5">
            {isActiveMentor ? (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-200">Mentor workspace</p>
                <p className="mt-2 text-lg font-bold">Build and manage your courses</p>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Open Mentor Studio to create courses, organize curriculum and submit learning experiences for Sea N Shore review.
                </p>
                <Link href="/learn/studio" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-teal-50">
                  Mentor Studio <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </>
            ) : (
              <>
                <p className="text-xs font-bold uppercase tracking-[0.15em] text-teal-200">Teach what you know</p>
                <p className="mt-2 text-lg font-bold">Experienced maritime professional?</p>
                <p className="mt-2 text-sm leading-6 text-white/68">
                  Apply to become a Sea N Shore mentor. Approved mentors can build structured courses and submit them for quality review.
                </p>
                <Link href="/learn/teach" className="mt-4 inline-flex items-center gap-2 rounded-xl bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:bg-teal-50">
                  Teach on Sea N Shore <ArrowRight aria-hidden="true" className="size-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="mt-6 rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5">
        <form action="/learn" method="get" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input aria-label="Search maritime courses" type="search" name="search" defaultValue={search ?? ''} placeholder="Search courses, skills or mentors" className="w-full rounded-xl border border-mist-200 bg-mist-50/60 py-3 pl-10 pr-4 text-sm font-semibold text-navy-950 outline-none transition placeholder:font-normal placeholder:text-muted focus:border-teal-400 focus:bg-white" />
          </div>
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <button type="submit" className="rounded-xl bg-navy-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-navy-900">Search courses</button>
          {hasFilters ? <Link href="/learn" className="px-2 py-2 text-center text-sm font-bold text-teal-800 hover:text-teal-700">Clear filters</Link> : null}
        </form>

        <div className="mt-4 flex gap-2 overflow-x-auto pb-1" aria-label="Course categories">
          <Link href={allCoursesHref(search)} aria-current={category ? undefined : 'page'} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${category ? 'border-mist-200 bg-white text-muted hover:border-teal-300 hover:text-teal-800' : 'border-navy-950 bg-navy-950 text-white'}`}>
            All courses
          </Link>
          {categories.map((item) => {
            const active = category === item
            return <Link key={item} href={categoryHref(item, search)} aria-current={active ? 'page' : undefined} className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-bold transition ${active ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-200 bg-white text-muted hover:border-teal-300 hover:text-teal-800'}`}>{item}</Link>
          })}
        </div>
      </section>

      <section className="mt-7">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Explore learning</p>
            <h2 className="mt-1 text-2xl font-bold tracking-tight text-navy-950">{hasFilters ? 'Courses matching your filters' : 'Published maritime courses'}</h2>
          </div>
          <p className="text-sm font-semibold text-muted">{courses.length} {courses.length === 1 ? 'course' : 'courses'}</p>
        </div>

        {courses.length ? (
          <div className="mt-4 grid gap-5 md:grid-cols-2 xl:grid-cols-3">{courses.map((course) => <CourseCard key={course.id} course={course} />)}</div>
        ) : (
          <div className="mt-4 rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center shadow-[var(--shadow-card)] sm:p-10">
            <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-800"><BookOpen aria-hidden="true" className="size-5" /></span>
            <h2 className="mt-4 text-xl font-bold text-navy-950">{hasFilters ? 'No courses match these filters yet.' : 'No published courses yet.'}</h2>
            <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">
              {hasFilters ? 'Try another maritime category or remove the current filters. Only courses that have completed Sea N Shore review appear here.' : 'The learning catalog is ready for reviewed maritime courses. New courses will appear here after they complete Sea N Shore quality review.'}
            </p>
            {hasFilters ? (
              <Link href="/learn" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
                Browse all courses <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            ) : (
              <Link href="/learn/teach" className="mt-5 inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900">
                Teach on Sea N Shore <ArrowRight aria-hidden="true" className="size-4" />
              </Link>
            )}
          </div>
        )}
      </section>
    </main>
  )
}
