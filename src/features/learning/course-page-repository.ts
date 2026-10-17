import type { QueryResultRow } from 'pg'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { query as databaseQuery } from '@/lib/db/client'
import { organizationLogoUrl, organizationTagline } from '@/features/organizations/organization-page-profile'
import { certificateSettingsFromRow, type CourseCertificateSettings } from './certificate-settings'
import { LIST_PRICE_EVIDENCE_DAYS, type ListPriceSale } from './course-pricing'

/**
 * Round H (H7): read-only extras for the public course page and the catalogue: evidence that a list price was
 * really charged (for struck-through prices), the trainer or publisher card and the certificate preview settings.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type CoursePublisherCard = {
  kind: 'person' | 'organization'
  name: string
  /** /people/<slug> or /organizations/<slug>; null when the publisher has no public page. */
  href: string | null
  /** Short bio (trainer) or tagline (organization), at most BIO_MAX characters. */
  bio: string | null
  /** Storage key of the trainer's profile photo (signed by the caller), or null. */
  photoPath: string | null
  /** The organization's logo link, or null. */
  logoUrl: string | null
  otherCourses: { id: string; slug: string; title: string }[]
}

export type CertificatePreviewSettings = Pick<CourseCertificateSettings, 'template' | 'signatoryName' | 'signatoryTitle' | 'serialPrefix' | 'validityMonths'>

const BIO_MAX = 280
const OTHER_COURSES = 3

/** Trims a bio to whole words, with an ellipsis. */
export function shortBio(value: string | null | undefined, max = BIO_MAX) {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return null
  if (text.length <= max) return text
  const cut = text.slice(0, max - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

export function createCoursePageRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  /**
   * Paid orders at the full list price in the last 90 days: status 'paid', no sale price, no promo code, not a
   * seat pack, and the amount equal to the list price. Never throws to the page: no evidence means no struck price.
   */
  async function listRecentListPriceSales(courseIds: readonly string[]): Promise<ListPriceSale[]> {
    const ids = [...new Set(courseIds)].filter(Boolean)
    if (!ids.length) return []
    const rows = await queryRows(
      `select distinct course_id, plan_id, list_price_minor, currency
       from public.course_payment_orders
       where course_id = any($1::uuid[])
         and status = 'paid'
         and paid_at > now() - make_interval(days => $2::int)
         and discount_price_minor is null
         and coalesce(promo_discount_minor, 0) = 0
         and seat_company_id is null
         and amount_minor = list_price_minor`,
      [ids, LIST_PRICE_EVIDENCE_DAYS],
    )
    return rows.map((row) => ({
      courseId: String(row.course_id),
      planId: row.plan_id ? String(row.plan_id) : null,
      listPriceMinor: Number(row.list_price_minor),
      currency: String(row.currency),
    }))
  }

  /**
   * The trainer (approved mentor application: name, short bio, profile photo) or the publishing organization
   * (name, tagline, logo), with up to three of their other discoverable published courses.
   */
  async function getPublisherCard(courseId: string): Promise<CoursePublisherCard | null> {
    const rows = await queryRows(
      `select
         case when course.company_id is null then 'person' else 'organization' end as kind,
         case when course.company_id is null then application.applicant_name else company.name end as name,
         case when course.company_id is null then creator.slug else company.slug end as slug,
         application.short_bio,
         creator.avatar_path,
         company.id as company_id,
         company.logo_path,
         company.tagline,
         company.description,
         course.mentor_id,
         course.company_id as publisher_company_id
       from public.learning_courses course
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.user_id = mentor.user_id and application.status = 'approved'
       left join public.profiles creator on creator.id = coalesce(mentor.user_id, course.created_by_user_id)
       left join public.companies company on company.id = course.company_id
       where course.id = $1
       limit 1`,
      [courseId],
    )
    const row = rows[0]
    if (!row || !row.name) return null
    const organization = row.kind === 'organization'
    const others = await queryRows(
      `select course.id, course.slug, course.title
       from public.learning_courses course
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.companies company on company.id = course.company_id
       where course.id <> $1
         and course.status = 'published'
         and course.removed_at is null
         and course.is_discoverable = true
         and ${planVisibleSql('course', 'course')}
         and (
           ($2::uuid is not null and course.company_id = $2::uuid and company.is_verified = true)
           or ($2::uuid is null and course.company_id is null and course.mentor_id = $3::uuid and mentor.status = 'active')
         )
       order by course.published_at desc nulls last, course.id
       limit $4`,
      [courseId, row.publisher_company_id ?? null, row.mentor_id ?? null, OTHER_COURSES],
    ).catch(() => [] as QueryResultRow[])
    return {
      kind: organization ? 'organization' : 'person',
      name: String(row.name),
      href: row.slug ? (organization ? `/organizations/${row.slug}` : `/people/${row.slug}`) : null,
      bio: shortBio(organization ? organizationTagline({ tagline: row.tagline, description: row.description }) : row.short_bio),
      photoPath: organization ? null : (row.avatar_path ? String(row.avatar_path) : null),
      logoUrl: organization && row.company_id ? organizationLogoUrl({ id: String(row.company_id), logoPath: row.logo_path ?? null }) : null,
      otherCourses: others.map((other) => ({ id: String(other.id), slug: String(other.slug), title: String(other.title) })),
    }
  }

  /** The look of the course's certificate (no logo or signature image: those are never shown publicly). */
  async function getCertificatePreviewSettings(courseId: string): Promise<CertificatePreviewSettings | null> {
    const rows = await queryRows(
      `select certificate_enabled, certificate_template, certificate_signatory_name, certificate_signatory_title,
              certificate_serial_prefix, certificate_validity_months
       from public.learning_courses where id = $1 limit 1`,
      [courseId],
    )
    const row = rows[0]
    if (!row || row.certificate_enabled !== true) return null
    const settings = certificateSettingsFromRow(row)
    return {
      template: settings.template,
      signatoryName: settings.signatoryName,
      signatoryTitle: settings.signatoryTitle,
      serialPrefix: settings.serialPrefix,
      validityMonths: settings.validityMonths,
    }
  }

  return { listRecentListPriceSales, getPublisherCard, getCertificatePreviewSettings }
}

export const coursePageRepository = createCoursePageRepository()
