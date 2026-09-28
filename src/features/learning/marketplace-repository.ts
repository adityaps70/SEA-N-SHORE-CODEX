import type { QueryResultRow } from 'pg'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { query as databaseQuery } from '@/lib/db/client'
import { isSyntheticDiscoveryText } from '@/lib/public-discovery'

type MarketplaceQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type MarketplaceCourseRow = QueryResultRow & {
  id: string
  mentor_id: string
  mentor_name: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: MarketplaceCourse['level']
  language: string
  thumbnail_path: string | null
  trailer_path: string | null
  learning_outcomes: string[] | null
  requirements: string[] | null
  target_audience: string[] | null
  certificate_enabled: boolean
  course_format: MarketplaceCourse['courseFormat']
  access_type: MarketplaceCourse['accessType']
  price_minor: string | number
  discount_price_minor?: string | number | null
  currency: string
  published_at: string | Date
}

export type MarketplaceCourse = {
  id: string
  mentorId: string
  mentorName: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
  language: string
  thumbnailPath: string | null
  trailerPath: string | null
  learningOutcomes: string[]
  requirements: string[]
  targetAudience: string[]
  certificateEnabled: boolean
  courseFormat: 'recorded' | 'live_cohort' | 'hybrid'
  accessType: 'free' | 'paid'
  priceMinor: number
  /** Lower sale price the trainer set, if any (see course-pricing.ts for when it applies). */
  discountPriceMinor?: number | null
  currency: string
  publishedAt: string
}

/** Public facts shown on a course page: section/lesson counts, length, learners and the publisher link. */
export type PublishedCourseOverview = {
  sections: { title: string; lessonCount: number }[]
  lessonCount: number
  durationSeconds: number
  learnerCount: number
  publisher: { kind: 'person' | 'organization'; slug: string } | null
}

type OverviewSectionRow = QueryResultRow & {
  section_title: string | null
  lesson_count: string | number | null
  duration_seconds: string | number | null
}

type OverviewCourseRow = QueryResultRow & {
  learner_count: string | number | null
  publisher_kind: 'person' | 'organization'
  publisher_slug: string | null
}

export type MarketplaceCourseFilters = {
  category?: string | null
  search?: string | null
}

const marketplaceSelect = `select
  course.id,
  coalesce(course.mentor_id::text, course.created_by_user_id::text) as mentor_id,
  case
    when course.company_id is null then application.applicant_name
    else company.name
  end as mentor_name,
  course.slug,
  course.title,
  course.subtitle,
  course.description,
  course.category,
  course.level,
  course.language,
  course.thumbnail_path,
  course.trailer_path,
  course.learning_outcomes,
  course.requirements,
  course.target_audience,
  course.certificate_enabled,
  course.course_format,
  course.access_type,
  course.price_minor,
  course.discount_price_minor,
  course.currency,
  course.published_at
from public.learning_courses course
left join public.learning_mentors mentor
  on mentor.id = course.mentor_id
left join public.learning_mentor_applications application
  on application.user_id = mentor.user_id
 and application.status = 'approved'
left join public.companies company
  on company.id = course.company_id`

/**
 * Listed and open to new learners: also drops courses removed with their owner's account
 * and courses whose owner's plan ended (see course-publication / billing/plan-visibility).
 */
const marketplaceVisibility = `course.status = 'published'
  and (
    (
      course.company_id is null
      and mentor.status = 'active'
      and application.status = 'approved'
    )
    or (
      course.company_id is not null
      and company.is_verified = true
    )
  )
  and course.removed_at is null
  and ${planVisibleSql('course', 'course')}`

const marketplaceDiscoveryVisibility = `${marketplaceVisibility}
  and course.is_discoverable = true`

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function mapCourse(row: MarketplaceCourseRow): MarketplaceCourse {
  return {
    id: row.id,
    mentorId: row.mentor_id,
    mentorName: row.mentor_name,
    slug: row.slug,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    category: row.category,
    level: row.level,
    language: row.language,
    thumbnailPath: row.thumbnail_path,
    trailerPath: row.trailer_path,
    learningOutcomes: row.learning_outcomes ?? [],
    requirements: row.requirements ?? [],
    targetAudience: row.target_audience ?? [],
    certificateEnabled: row.certificate_enabled,
    courseFormat: row.course_format,
    accessType: row.access_type,
    priceMinor: Number(row.price_minor),
    discountPriceMinor: row.discount_price_minor === null || row.discount_price_minor === undefined ? null : Number(row.discount_price_minor),
    currency: row.currency,
    publishedAt: isoDateTime(row.published_at),
  }
}

function isPublicMarketplaceCourse(course: MarketplaceCourse) {
  return !isSyntheticDiscoveryText([
    course.slug,
    course.title,
    course.subtitle,
    course.description,
    course.mentorName,
  ].filter(Boolean).join(' '))
}

export function createMarketplaceRepository(input: { query?: MarketplaceQuery } = {}) {
  const queryRows: MarketplaceQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function listPublishedCourses(filters: MarketplaceCourseFilters = {}): Promise<MarketplaceCourse[]> {
    const category = filters.category?.trim() || null
    const normalizedSearch = filters.search?.trim().toLowerCase() || null
    const searchPattern = normalizedSearch ? `%${normalizedSearch}%` : null
    const values: unknown[] = []
    const discoveryClauses: string[] = []

    if (category) {
      values.push(category)
      discoveryClauses.push(`course.category = $${values.length}`)
    }

    if (searchPattern) {
      values.push(searchPattern)
      const placeholder = `$${values.length}`
      discoveryClauses.push(`(
        course.title ilike ${placeholder}
        or course.description ilike ${placeholder}
        or (
          case
            when course.company_id is null then application.applicant_name
            else company.name
          end
        ) ilike ${placeholder}
      )`)
    }

    const discovery = discoveryClauses.length ? `\n  and ${discoveryClauses.join('\n  and ')}` : ''
    const rows = await queryRows(
      `${marketplaceSelect}
where ${marketplaceDiscoveryVisibility}${discovery}
order by course.published_at desc, course.id desc`,
      values,
    ) as MarketplaceCourseRow[]

    return rows.map(mapCourse).filter(isPublicMarketplaceCourse)
  }

  /** Catalog courses published as one organization (organization page Courses tab). */
  async function listPublishedCoursesForCompany(companyId: string, limit = 30): Promise<MarketplaceCourse[]> {
    const rows = await queryRows(
      `${marketplaceSelect}
where ${marketplaceDiscoveryVisibility}
  and course.company_id = $1
order by course.published_at desc, course.id desc
limit $2`,
      [companyId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    ) as MarketplaceCourseRow[]

    return rows.map(mapCourse).filter(isPublicMarketplaceCourse)
  }

  async function getPublishedCourseBySlug(slug: string): Promise<MarketplaceCourse | null> {
    const normalizedSlug = slug.trim()
    if (!normalizedSlug) return null

    const rows = await queryRows(
      `${marketplaceSelect}
where course.slug = $1
  and ${marketplaceVisibility}
limit 1`,
      [normalizedSlug],
    ) as MarketplaceCourseRow[]

    const row = rows[0]
    return row ? mapCourse(row) : null
  }

  /**
   * Curriculum summary (published lessons only, no lesson content), learner count and the
   * publisher's profile or organization slug for a course the caller already loaded as published.
   */
  async function getPublishedCourseOverview(courseId: string): Promise<PublishedCourseOverview> {
    const [sectionRows, courseRows] = await Promise.all([
      queryRows(
        `select
  section.title as section_title,
  count(lesson.id) as lesson_count,
  coalesce(sum(lesson.duration_seconds), 0) as duration_seconds
from public.learning_course_sections section
left join public.learning_lessons lesson
  on lesson.section_id = section.id
 and lesson.is_published = true
where section.course_id = $1
group by section.id, section.title, section.position
order by section.position asc`,
        [courseId],
      ) as Promise<OverviewSectionRow[]>,
      queryRows(
        `select
  (select count(*) from public.learning_enrollments enrollment
    where enrollment.course_id = course.id
      and enrollment.status in ('active', 'completed')) as learner_count,
  case when course.company_id is null then 'person' else 'organization' end as publisher_kind,
  case when course.company_id is null then creator.slug else company.slug end as publisher_slug
from public.learning_courses course
left join public.profiles creator on creator.id = course.created_by_user_id
left join public.companies company on company.id = course.company_id
where course.id = $1
limit 1`,
        [courseId],
      ) as Promise<OverviewCourseRow[]>,
    ])

    const sections = sectionRows
      .map((row) => ({ title: row.section_title ?? '', lessonCount: Number(row.lesson_count ?? 0) }))
      .filter((section) => section.lessonCount > 0)
    const course = courseRows[0]
    return {
      sections,
      lessonCount: sections.reduce((total, section) => total + section.lessonCount, 0),
      durationSeconds: sectionRows.reduce((total, row) => total + Number(row.duration_seconds ?? 0), 0),
      learnerCount: Number(course?.learner_count ?? 0),
      publisher: course?.publisher_slug ? { kind: course.publisher_kind, slug: course.publisher_slug } : null,
    }
  }

  return {
    listPublishedCourses,
    listPublishedCoursesForCompany,
    getPublishedCourseBySlug,
    getPublishedCourseOverview,
  }
}

export const marketplaceRepository = createMarketplaceRepository()
