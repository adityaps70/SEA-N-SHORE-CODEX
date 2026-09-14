import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

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
  currency: string
  publishedAt: string
}

export type MarketplaceCourseFilters = {
  category?: string | null
  search?: string | null
}

const marketplaceSelect = `select
  course.id,
  course.mentor_id,
  application.name as mentor_name,
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
  course.currency,
  course.published_at
from public.learning_courses course
inner join public.learning_mentors mentor
  on mentor.id = course.mentor_id
inner join public.learning_mentor_applications application
  on application.user_id = mentor.user_id
 and application.status = 'approved'`

const marketplaceVisibility = `course.status = 'published'
  and mentor.status = 'active'
  and course.access_type = 'free'
  and course.price_minor = 0`

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
    currency: row.currency,
    publishedAt: isoDateTime(row.published_at),
  }
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
        or application.name ilike ${placeholder}
      )`)
    }

    const discovery = discoveryClauses.length ? `\n  and ${discoveryClauses.join('\n  and ')}` : ''
    const rows = await queryRows(
      `${marketplaceSelect}
where ${marketplaceVisibility}${discovery}
order by course.published_at desc, course.id desc`,
      values,
    ) as MarketplaceCourseRow[]

    return rows.map(mapCourse)
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

  return {
    listPublishedCourses,
    getPublishedCourseBySlug,
  }
}

export const marketplaceRepository = createMarketplaceRepository()
