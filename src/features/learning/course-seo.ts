import type { Metadata } from 'next'
import { BRAND_ICONS } from '@/components/brand/brand-assets'
import { metaDescription } from '@/lib/seo/meta'
import { coursePrice, isPaidCourse } from './course-pricing'
import type { MarketplaceCourse } from './marketplace-repository'

/**
 * Search and share metadata for the public course catalogue and course pages: title, description,
 * canonical address, Open Graph / Twitter cards (WhatsApp and LinkedIn read Open Graph) and
 * schema.org Course data. Images are static or the course's own public cover; nothing is generated.
 */

export function siteOrigin() {
  return process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/+$/, '') || 'https://seanshore.in'
}

export function coursePath(slug: string) {
  return `/learn/courses/${slug}`
}

/** Public cover image of a course, served to anyone by /api/learning-media (public courses only). */
export function courseCoverPath(thumbnailPath: string | null) {
  return thumbnailPath ? `/api/learning-media/${thumbnailPath}` : null
}

/**
 * One or two sentences for search results and share cards.
 * Round H (H5): plain text via the shared metaDescription (Markdown markers and emoji removed, at most 160 characters);
 * the description is used when the subtitle is empty or has nothing left once those are removed.
 */
export function courseMetaDescription(course: Pick<MarketplaceCourse, 'subtitle' | 'description'>) {
  return metaDescription(course.subtitle, course.description)
}

export function courseMetadata(course: MarketplaceCourse): Metadata {
  const description = courseMetaDescription(course)
  const cover = courseCoverPath(course.thumbnailPath)
  const images = cover
    ? [{ url: cover, alt: `${course.title} course cover` }]
    : [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }]
  return {
    title: course.title,
    description,
    alternates: { canonical: coursePath(course.slug) },
    openGraph: {
      type: 'website',
      siteName: 'Sea N Shore',
      title: course.title,
      description,
      url: coursePath(course.slug),
      images,
    },
    twitter: { card: 'summary_large_image', title: course.title, description, images: images.map((image) => image.url) },
  }
}

export const CATALOGUE_DESCRIPTION = 'Practical maritime courses from trainers and organizations Sea N Shore has verified, reviewed before they are published.'

export function catalogueMetadata(): Metadata {
  return {
    title: 'Maritime courses',
    description: CATALOGUE_DESCRIPTION,
    alternates: { canonical: '/learn' },
    openGraph: {
      type: 'website',
      siteName: 'Sea N Shore',
      title: 'Maritime courses on Sea N Shore',
      description: CATALOGUE_DESCRIPTION,
      url: '/learn',
      images: [{ url: BRAND_ICONS.ogImage, width: 1200, height: 630, alt: 'Sea N Shore' }],
    },
    twitter: { card: 'summary_large_image', title: 'Maritime courses on Sea N Shore', description: CATALOGUE_DESCRIPTION, images: [BRAND_ICONS.ogImage] },
  }
}

const LEVELS: Record<MarketplaceCourse['level'], string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
  all_levels: 'All levels',
}

/** schema.org Course, so search engines can show the course as a course. */
export function courseJsonLd(
  course: MarketplaceCourse,
  provider: { kind: 'person' | 'organization'; slug: string } | null,
  /** Learning round C: approved reviews only; aggregateRating is left out when there are none. */
  rating: { averageRating: number | null; reviewCount: number } | null = null,
) {
  const origin = siteOrigin()
  const url = `${origin}${coursePath(course.slug)}`
  const cover = courseCoverPath(course.thumbnailPath)
  const price = isPaidCourse(course) ? coursePrice(course) : null
  const providerUrl = provider ? `${origin}/${provider.kind === 'organization' ? 'organizations' : 'people'}/${provider.slug}` : undefined
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: course.title,
    description: courseMetaDescription(course),
    url,
    inLanguage: course.language,
    educationalLevel: LEVELS[course.level],
    about: course.category,
    ...(cover ? { image: `${origin}${cover}` } : {}),
    ...(course.learningOutcomes.length ? { teaches: course.learningOutcomes } : {}),
    provider: {
      '@type': provider?.kind === 'person' ? 'Person' : 'Organization',
      name: course.mentorName,
      ...(providerUrl ? { url: providerUrl } : {}),
    },
    offers: {
      '@type': 'Offer',
      category: price ? 'Paid' : 'Free',
      price: price ? (price.amountMinor / 100).toFixed(2) : '0',
      priceCurrency: price?.currency ?? course.currency,
      url,
      availability: 'https://schema.org/InStock',
    },
    hasCourseInstance: {
      '@type': 'CourseInstance',
      // Recorded and live-cohort courses both run online here; hybrid mixes online and in person.
      courseMode: course.courseFormat === 'hybrid' ? 'Blended' : 'Online',
    },
    ...(rating && rating.reviewCount > 0 && rating.averageRating !== null
      ? {
        aggregateRating: {
          '@type': 'AggregateRating',
          ratingValue: rating.averageRating.toFixed(1),
          ratingCount: rating.reviewCount,
          reviewCount: rating.reviewCount,
          bestRating: 5,
          worstRating: 1,
        },
      }
      : {}),
  }
}
