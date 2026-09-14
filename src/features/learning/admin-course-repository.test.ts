import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'

const administratorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const courseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mentorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const mentorUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

describe('learning admin course review repository', () => {
  it('fails closed before listing submitted courses for a non-administrator', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return []
      return []
    }
    const repository = createLearningAdminRepository({ query })

    await expect(repository.listCoursesForReview(administratorId, 'submitted')).rejects.toThrow('admin_forbidden')
    expect(seen.some((entry) => entry.text.includes('from public.learning_courses'))).toBe(false)
  })

  it('lists course review items with mentor identity and maritime course metadata oldest-first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses course')) {
        return [{
          course_id: courseId,
          mentor_id: mentorId,
          mentor_user_id: mentorUserId,
          mentor_name: 'Capt. Asha Menon',
          slug: 'sire-2-readiness',
          title: 'SIRE 2.0 Readiness',
          subtitle: 'Practical tanker inspection preparation',
          description: 'A detailed practical course for tanker officers preparing for SIRE 2.0 inspections and competency conversations.',
          category: 'SIRE 2.0',
          level: 'advanced',
          language: 'English',
          learning_outcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
          requirements: ['Tanker experience'],
          target_audience: ['Deck officers'],
          price_minor: '0',
          discount_price_minor: null,
          currency: 'INR',
          access_type: 'free',
          certificate_enabled: true,
          course_format: 'recorded',
          status: 'submitted',
          admin_review_note: null,
          updated_at: new Date('2026-09-14T12:00:00.000Z'),
        }]
      }
      return []
    }
    const repository = createLearningAdminRepository({ query })

    await expect(repository.listCoursesForReview(administratorId, 'submitted')).resolves.toEqual([{
      courseId,
      mentorId,
      mentorUserId,
      mentorName: 'Capt. Asha Menon',
      slug: 'sire-2-readiness',
      title: 'SIRE 2.0 Readiness',
      subtitle: 'Practical tanker inspection preparation',
      description: 'A detailed practical course for tanker officers preparing for SIRE 2.0 inspections and competency conversations.',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
      requirements: ['Tanker experience'],
      targetAudience: ['Deck officers'],
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      accessType: 'free',
      certificateEnabled: true,
      courseFormat: 'recorded',
      status: 'submitted',
      adminReviewNote: null,
      updatedAt: '2026-09-14T12:00:00.000Z',
    }])

    const listQuery = seen.find((entry) => entry.text.includes('from public.learning_courses course'))
    expect(listQuery?.values).toEqual(['submitted'])
    expect(listQuery?.text).toContain('order by course.updated_at asc, course.id asc')
    expect(listQuery?.text).toContain('learning_mentor_applications')
  })

  it('requests changes transactionally, records reviewer feedback and writes an audit event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(
      administratorId,
      courseId,
      'changes_requested',
      'Please make the outcomes measurable and add a vessel-specific example.',
    )).resolves.toEqual({ courseId, status: 'changes_requested' })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values).toEqual([
      courseId,
      'changes_requested',
      administratorId,
      'Please make the outcomes measurable and add a vessel-specific example.',
    ])
    expect(update?.text).toContain('reviewed_by = $3')
    expect(update?.text).toContain('reviewed_at = now()')
    expect(update?.text).toContain('admin_review_note = $4')
    expect(update?.text).toContain('approved_at = null')
    expect(update?.text).toContain('published_at = null')

    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.values).toContain('learning.course.changes_requested')
    expect(audit?.values).toContain(courseId)
    expect(audit?.values).toContain(administratorId)
  })

  it('approves a submitted course and stamps approval metadata without publishing it', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'approved', null)).resolves.toEqual({
      courseId,
      status: 'approved',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('approved_at = now()')
    expect(update?.text).toContain('published_at = null')
    expect(update?.values).toEqual([courseId, 'approved', administratorId, null])
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('learning.course.approved')
  })

  it('publishes only from approved and stamps published_at', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'approved' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'published', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('published_at = now()')
    expect(update?.values).toEqual([courseId, 'published', administratorId, null])
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('learning.course.published')
  })

  it('rejects an administrator transition that skips the course workflow', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'published', null)).rejects.toThrow('course_transition_forbidden')
  })
})
