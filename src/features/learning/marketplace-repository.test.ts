import { describe, expect, it } from 'vitest'
import { createMarketplaceRepository } from './marketplace-repository'

const courseId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'

const publishedRow = {
  id: courseId,
  mentor_id: mentorId,
  mentor_name: 'Capt. Maya Singh',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  description: 'A practical maritime course covering evidence-led SIRE 2.0 preparation, officer readiness and onboard execution.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnail_path: 'learning/courses/sire-2/thumbnail.jpg',
  trailer_path: 'learning/courses/sire-2/trailer.mp4',
  learning_outcomes: ['Prepare evidence for SIRE 2.0 interviews', 'Run an effective onboard readiness review'],
  requirements: ['Officer-level tanker experience'],
  target_audience: ['Deck officers', 'Marine superintendents'],
  certificate_enabled: true,
  course_format: 'recorded',
  access_type: 'paid',
  price_minor: 2_000_000,
  currency: 'INR',
  published_at: new Date('2026-09-14T12:00:00.000Z'),
}

describe('learning marketplace repository', () => {
  it('lists published courses from active verified mentors, including paid courses, newest first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMarketplaceRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [publishedRow]
      },
    })

    await expect(repository.listPublishedCourses()).resolves.toEqual([{
      id: courseId,
      mentorId,
      mentorName: 'Capt. Maya Singh',
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical inspection readiness from a Master Mariner',
      description: publishedRow.description,
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      thumbnailPath: 'learning/courses/sire-2/thumbnail.jpg',
      trailerPath: 'learning/courses/sire-2/trailer.mp4',
      learningOutcomes: publishedRow.learning_outcomes,
      requirements: publishedRow.requirements,
      targetAudience: publishedRow.target_audience,
      certificateEnabled: true,
      courseFormat: 'recorded',
      accessType: 'paid',
      priceMinor: 2_000_000,
      currency: 'INR',
      publishedAt: '2026-09-14T12:00:00.000Z',
    }])

    const query = seen[0]
    expect(query?.text).toContain('application.applicant_name as mentor_name')
    expect(query?.text).toContain("course.status = 'published'")
    expect(query?.text).toContain("mentor.status = 'active'")
    expect(query?.text).toContain("application.status = 'approved'")
    expect(query?.text).not.toContain("course.access_type = 'free'")
    expect(query?.text).not.toContain('course.price_minor = 0')
    expect(query?.text).toContain('order by course.published_at desc, course.id desc')
  })

  it('supports category and text discovery without weakening publication visibility', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMarketplaceRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return []
      },
    })

    await repository.listPublishedCourses({ category: 'SIRE 2.0', search: '  tanker readiness  ' })

    expect(seen[0]?.values).toEqual(['SIRE 2.0', '%tanker readiness%'])
    expect(seen[0]?.text).toContain('course.category = $1')
    expect(seen[0]?.text).toContain('course.title ilike $2')
    expect(seen[0]?.text).toContain('course.description ilike $2')
    expect(seen[0]?.text).toContain('application.applicant_name ilike $2')
    expect(seen[0]?.text).toContain("course.status = 'published'")
  })

  it('loads a published paid course by slug using the same mentor visibility guards', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMarketplaceRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [publishedRow]
      },
    })

    await expect(repository.getPublishedCourseBySlug('sire-2-readiness-for-tanker-officers')).resolves.toMatchObject({
      id: courseId,
      slug: 'sire-2-readiness-for-tanker-officers',
      mentorName: 'Capt. Maya Singh',
      accessType: 'paid',
      priceMinor: 2_000_000,
    })

    expect(seen[0]?.values).toEqual(['sire-2-readiness-for-tanker-officers'])
    expect(seen[0]?.text).toContain('course.slug = $1')
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain("application.status = 'approved'")
    expect(seen[0]?.text).not.toContain("course.access_type = 'free'")
    expect(seen[0]?.text).not.toContain('course.price_minor = 0')
  })

  it('returns null when the published slug is not visible', async () => {
    const repository = createMarketplaceRepository({ query: async () => [] })

    await expect(repository.getPublishedCourseBySlug('missing-course')).resolves.toBeNull()
  })
})