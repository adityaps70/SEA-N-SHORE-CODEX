import { describe, expect, it } from 'vitest'
import type { CourseDraftInput } from './course-repository'
import { createCourseRepository } from './course-repository'

const mentorUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const companyId = '44444444-4444-4444-8444-444444444444'

function courseInput(overrides: Partial<CourseDraftInput> = {}): CourseDraftInput {
  return {
    slug: 'sire-2-readiness-for-tanker-officers',
    title: 'SIRE 2.0 Readiness for Tanker Officers',
    subtitle: 'Practical preparation for inspections and onboard competency',
    description: 'A practical maritime course that helps tanker officers understand SIRE 2.0 expectations, prepare evidence and improve onboard competency before an inspection.',
    category: 'SIRE 2.0',
    level: 'advanced',
    language: 'English',
    thumbnailPath: null,
    trailerPath: null,
    learningOutcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
    requirements: ['Active or recent tanker experience'],
    targetAudience: ['Deck Officers', 'Marine Superintendents'],
    accessType: 'free',
    priceMinor: 0,
    discountPriceMinor: null,
    currency: 'INR',
    certificateEnabled: true,
    courseFormat: 'recorded',
    ...overrides,
  }
}

describe('learning course repository', () => {
  it('creates a draft course only for an active approved mentor', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.learning_mentors')) return [{ id: mentorId }]
        if (text.includes('insert into public.learning_courses')) return [{ id: courseId }]
        return []
      },
    })

    await expect(repository.createCourse(mentorUserId, courseInput())).resolves.toEqual({ courseId })

    const mentorLookup = seen.find((entry) => entry.text.includes('from public.learning_mentors'))
    expect(mentorLookup?.text).toContain("status = 'active'")
    expect(mentorLookup?.values).toEqual([mentorUserId])

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_courses'))
    expect(insert?.values).toContain(mentorId)
    expect(insert?.values).toContain('sire-2-readiness-for-tanker-officers')
    expect(insert?.values).toContain('draft')
    expect(insert?.values).toContain('free')
    expect(insert?.values).toContain(0)
  })

  it('fails closed when the authenticated user is not an active mentor', async () => {
    const seen: string[] = []
    const repository = createCourseRepository({
      query: async (text) => {
        seen.push(text)
        return []
      },
    })

    await expect(repository.createCourse(mentorUserId, courseInput())).rejects.toThrow('mentor_required')
    expect(seen.some((text) => text.includes('insert into public.learning_courses'))).toBe(false)
  })

  it('lists only courses owned by the authenticated mentor', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: courseId,
          slug: 'sire-2-readiness-for-tanker-officers',
          title: 'SIRE 2.0 Readiness for Tanker Officers',
          subtitle: 'Practical preparation for inspections and onboard competency',
          category: 'SIRE 2.0',
          level: 'advanced',
          course_format: 'recorded',
          access_type: 'free',
          status: 'draft',
          admin_review_note: null,
          updated_at: new Date('2026-09-14T12:00:00.000Z'),
        }]
      },
    })

    await expect(repository.listOwnedCourses(mentorUserId)).resolves.toEqual([{
      id: courseId,
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical preparation for inspections and onboard competency',
      category: 'SIRE 2.0',
      level: 'advanced',
      courseFormat: 'recorded',
      accessType: 'free',
      status: 'draft',
      adminReviewNote: null,
      updatedAt: '2026-09-14T12:00:00.000Z',
    }])

    expect(seen[0]?.text).toContain('mentor.user_id = $1')
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.values).toEqual([mentorUserId])
  })

  it('updates an owned course only while its workflow state is editable by the mentor', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) {
        return [{ id: courseId, status: 'draft', mentor_id: mentorId }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createCourseRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.updateCourse(mentorUserId, courseId, courseInput({ title: 'Updated SIRE 2.0 Readiness for Tanker Officers' }))).resolves.toBe(true)

    const lock = seen.find((entry) => entry.text.includes('for update'))
    expect(lock?.text).toContain('mentor.user_id = $2')
    expect(lock?.text).toContain("mentor.status = 'active'")
    expect(lock?.values).toEqual([courseId, mentorUserId])

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values).toContain('Updated SIRE 2.0 Readiness for Tanker Officers')
    expect(update?.text).not.toContain("status = 'draft'")
  })

  it('rejects mentor edits after the course has been submitted for review', async () => {
    const seen: string[] = []
    const query = async (text: string) => {
      seen.push(text)
      if (text.includes('for update')) return [{ id: courseId, status: 'submitted', mentor_id: mentorId }]
      return []
    }
    const repository = createCourseRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.updateCourse(mentorUserId, courseId, courseInput())).rejects.toThrow('course_edit_forbidden')
    expect(seen.some((text) => text.includes('update public.learning_courses'))).toBe(false)
  })

  it('creates an organization course draft for an approved LMS manager without requiring mentor status', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        if (text.includes('from public.company_members')) {
          return [{ role: 'lms_manager', approved_at: '2026-09-25T00:00:00.000Z' }]
        }
        if (text.includes('insert into public.learning_courses')) return [{ id: courseId }]
        return []
      },
    })

    await expect(repository.createCourse(mentorUserId, {
      publisherType: 'organization',
      companyId,
      ...courseInput(),
    })).resolves.toEqual({ courseId })

    const membership = seen.find((entry) => entry.text.includes('from public.company_members'))
    expect(membership?.text).toContain("role::text in ('owner', 'administrator', 'lms_manager')")
    expect(membership?.values).toEqual([companyId, mentorUserId])

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_courses'))
    expect(insert?.text).toContain('created_by_user_id')
    expect(insert?.text).toContain('company_id')
    expect(insert?.values).toContain(mentorUserId)
    expect(insert?.values).toContain(companyId)
    expect(insert?.values).toContain(null)
  })

  it('rejects organization course creation without approved LMS management authority', async () => {
    const seen: string[] = []
    const repository = createCourseRepository({
      query: async (text) => {
        seen.push(text)
        return []
      },
    })

    await expect(repository.createCourse(mentorUserId, {
      publisherType: 'organization',
      companyId,
      ...courseInput(),
    })).rejects.toThrow('course_forbidden')
    expect(seen.some((text) => text.includes('insert into public.learning_courses'))).toBe(false)
  })

  it('lists personal mentor and organization-managed courses together', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: courseId,
          slug: 'bridge-resource-management',
          title: 'Bridge Resource Management',
          subtitle: null,
          category: 'Leadership',
          level: 'advanced',
          course_format: 'recorded',
          access_type: 'free',
          status: 'draft',
          admin_review_note: null,
          updated_at: new Date('2026-09-25T01:00:00.000Z'),
          company_id: companyId,
          publisher_name: 'Sea Academy',
          publisher_slug: 'sea-academy',
        }]
      },
    })

    await expect(repository.listOwnedCourses(mentorUserId)).resolves.toEqual([
      expect.objectContaining({
        id: courseId,
        companyId,
        publisherType: 'organization',
        publisherName: 'Sea Academy',
      }),
    ])
    expect(seen[0]?.text).toContain('public.company_members')
    expect(seen[0]?.text).toContain('lms_manager')
  })

  it('loads an organization course for an approved LMS manager and keeps its publisher locked', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [{
          id: courseId,
          slug: 'bridge-resource-management',
          title: 'Bridge Resource Management',
          subtitle: null,
          description: 'A detailed maritime course for bridge teams covering practical bridge resource management and decision making.',
          category: 'Leadership',
          level: 'advanced',
          language: 'English',
          thumbnail_path: null,
          trailer_path: null,
          learning_outcomes: [],
          requirements: [],
          target_audience: [],
          price_minor: '0',
          discount_price_minor: null,
          currency: 'INR',
          access_type: 'free',
          certificate_enabled: true,
          course_format: 'recorded',
          status: 'draft',
          admin_review_note: null,
          updated_at: new Date('2026-09-25T01:00:00.000Z'),
          company_id: companyId,
          publisher_name: 'Sea Academy',
          publisher_slug: 'sea-academy',
        }]
      },
    })

    await expect(repository.getOwnedCourse(mentorUserId, courseId)).resolves.toEqual(
      expect.objectContaining({
        id: courseId,
        companyId,
        publisherType: 'organization',
        publisherName: 'Sea Academy',
      }),
    )
    expect(seen[0]?.text).toContain('public.company_members')
    expect(seen[0]?.text).toContain('lms_manager')
  })

})
