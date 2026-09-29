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
  it('lists only discoverable published courses from active verified mentors, including paid courses, newest first', async () => {
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
      discountPriceMinor: null,
      currency: 'INR',
      publishedAt: '2026-09-14T12:00:00.000Z',
    }])

    const query = seen[0]
    expect(query?.text).toContain('case')
    expect(query?.text).toContain('company.name')
    expect(query?.text).toContain('as mentor_name')
    expect(query?.text).toContain("course.status = 'published'")
    expect(query?.text).toContain('course.is_discoverable = true')
    expect(query?.text).toContain("mentor.status = 'active'")
    expect(query?.text).toContain("application.status = 'approved'")
    expect(query?.text).toContain('public.companies company')
    expect(query?.text).toContain('company.is_verified = true')
    expect(query?.text).not.toContain("course.access_type = 'free'")
    expect(query?.text).not.toContain('course.price_minor = 0')
    expect(query?.text).toContain('order by course.published_at desc, course.id desc')
  })

  it('supports category and text discovery without weakening publication or discoverability visibility', async () => {
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
    expect(seen[0]?.text).toContain('company.name')
    expect(seen[0]?.text).toContain('ilike $2')
    expect(seen[0]?.text).toContain("course.status = 'published'")
    expect(seen[0]?.text).toContain('course.is_discoverable = true')
  })

  it('loads a published paid course by slug using the same mentor visibility guards without requiring catalog discoverability', async () => {
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
    expect(seen[0]?.text).toContain('company.is_verified = true')
    expect(seen[0]?.text).not.toContain('course.is_discoverable = true')
    // Removed with the owner's account, or the owner's plan ended: not shown or sold to new learners.
    expect(seen[0]?.text).toContain('course.removed_at is null')
    expect(seen[0]?.text).toContain('course.hidden_for_plan_at is null')
    expect(seen[0]?.text).not.toContain("course.access_type = 'free'")
    expect(seen[0]?.text).not.toContain('course.price_minor = 0')
  })

  it('returns null when the published slug is not visible', async () => {
    const repository = createMarketplaceRepository({ query: async () => [] })

    await expect(repository.getPublishedCourseBySlug('missing-course')).resolves.toBeNull()
  })

  it('lists a verified organization-published course with the organization as publisher', async () => {
    const repository = createMarketplaceRepository({
      query: async () => [{
        ...publishedRow,
        mentor_id: '99999999-9999-4999-8999-999999999999',
        mentor_name: 'Sea Academy',
      }],
    })

    await expect(repository.listPublishedCourses()).resolves.toEqual([
      expect.objectContaining({
        id: courseId,
        mentorName: 'Sea Academy',
        title: 'SIRE 2.0 Readiness for Tanker Officers',
      }),
    ])
  })

  it('summarizes a published course for the phone page: published lessons per section, length, learners and publisher slug', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMarketplaceRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        if (text.includes('learning_course_sections')) {
          return [
            { section_title: 'Inspection foundations', lesson_count: '5', duration_seconds: '7200' },
            { section_title: 'Empty draft section', lesson_count: '0', duration_seconds: '0' },
            { section_title: 'Inspection day', lesson_count: 7, duration_seconds: 14400 },
          ]
        }
        return [{ learner_count: '312', publisher_kind: 'person', publisher_slug: 'maya-singh' }]
      },
    })

    await expect(repository.getPublishedCourseOverview(courseId)).resolves.toEqual({
      sections: [{ title: 'Inspection foundations', lessonCount: 5 }, { title: 'Inspection day', lessonCount: 7 }],
      lessonCount: 12,
      durationSeconds: 21600,
      learnerCount: 312,
      publisher: { kind: 'person', slug: 'maya-singh' },
    })
    const sections = seen.find((entry) => entry.text.includes('learning_course_sections'))
    expect(sections?.values).toEqual([courseId])
    expect(sections?.text).toContain('lesson.is_published = true')
    expect(sections?.text).not.toContain('article_body')
    const course = seen.find((entry) => entry.text.includes('learner_count'))
    expect(course?.text).toContain("enrollment.status in ('active', 'completed')")
  })

  it('has no publisher link when the publisher has no public slug', async () => {
    const repository = createMarketplaceRepository({
      query: async (text: string) => text.includes('learning_course_sections') ? [] : [{ learner_count: 0, publisher_kind: 'organization', publisher_slug: null }],
    })
    await expect(repository.getPublishedCourseOverview(courseId)).resolves.toMatchObject({ lessonCount: 0, publisher: null })
  })
})
