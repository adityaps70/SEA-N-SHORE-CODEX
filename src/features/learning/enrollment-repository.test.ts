import { describe, expect, it } from 'vitest'
import { createEnrollmentRepository } from './enrollment-repository'

const learnerId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const enrollmentId = '33333333-3333-4333-8333-333333333333'

const enrollmentRow = {
  id: enrollmentId,
  status: 'active',
  enrollment_source: 'free',
  enrolled_at: new Date('2026-09-14T12:00:00.000Z'),
  completed_at: null,
  revoked_at: null,
}

describe('learning enrollment repository', () => {
  it('creates a free enrollment only from the currently published Phase 1 marketplace', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        if (text.includes('insert into public.learning_enrollments')) return [enrollmentRow]
        return []
      },
    })

    await expect(repository.enrollFreeCourse(learnerId, courseId)).resolves.toEqual({
      enrollmentId,
      status: 'active',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      alreadyEnrolled: false,
    })

    const insert = seen[0]
    expect(insert?.values).toEqual([learnerId, courseId])
    expect(insert?.text).toContain('insert into public.learning_enrollments')
    expect(insert?.text).toContain("'free'")
    expect(insert?.text).toContain("'active'")
    expect(insert?.text).toContain("course.status = 'published'")
    expect(insert?.text).toContain("mentor.status = 'active'")
    expect(insert?.text).toContain("application.status = 'approved'")
    expect(insert?.text).toContain('public.companies company')
    expect(insert?.text).toContain('company.is_verified = true')
    expect(insert?.text).toContain("course.access_type = 'free'")
    expect(insert?.text).toContain('course.price_minor = 0')
    expect(insert?.text).toContain('on conflict (course_id, learner_id) do nothing')
  })

  it('is idempotent when the learner already has an active enrollment', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        if (text.includes('insert into public.learning_enrollments')) return []
        if (text.includes('from public.learning_enrollments enrollment')) return [enrollmentRow]
        return []
      },
    })

    await expect(repository.enrollFreeCourse(learnerId, courseId)).resolves.toEqual({
      enrollmentId,
      status: 'active',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      alreadyEnrolled: true,
    })

    expect(seen).toHaveLength(2)
    expect(seen[1]?.values).toEqual([learnerId, courseId])
    expect(seen[1]?.text).toContain('enrollment.learner_id = $1')
    expect(seen[1]?.text).toContain('enrollment.course_id = $2')
  })

  it('fails closed when the course is not currently enrollable', async () => {
    const repository = createEnrollmentRepository({ query: async () => [] })

    await expect(repository.enrollFreeCourse(learnerId, courseId)).rejects.toThrow('course_not_enrollable')
  })

  it('does not silently reactivate a revoked enrollment', async () => {
    const repository = createEnrollmentRepository({
      query: async (text: string) => {
        if (text.includes('insert into public.learning_enrollments')) return []
        if (text.includes('from public.learning_enrollments enrollment')) {
          return [{ ...enrollmentRow, status: 'revoked', revoked_at: new Date('2026-09-15T10:00:00.000Z') }]
        }
        return []
      },
    })

    await expect(repository.enrollFreeCourse(learnerId, courseId)).rejects.toThrow('enrollment_revoked')
  })

  it('loads the authenticated learner enrollment state for a course', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [enrollmentRow]
      },
    })

    await expect(repository.getLearnerEnrollment(learnerId, courseId)).resolves.toEqual({
      enrollmentId,
      status: 'active',
      enrollmentSource: 'free',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      completedAt: null,
      revokedAt: null,
    })

    expect(seen[0]?.values).toEqual([learnerId, courseId])
    expect(seen[0]?.text).toContain('enrollment.learner_id = $1')
    expect(seen[0]?.text).toContain('enrollment.course_id = $2')
  })

  it('lists only active or completed learning owned by the learner with progress counts', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        return [{
          enrollment_id: enrollmentId,
          enrollment_status: 'active',
          enrolled_at: new Date('2026-09-14T12:00:00.000Z'),
          completed_at: null,
          course_id: courseId,
          slug: 'sire-2-readiness-for-tanker-officers',
          title: 'SIRE 2.0 Readiness for Tanker Officers',
          subtitle: 'Practical inspection readiness from a Master Mariner',
          category: 'SIRE 2.0',
          level: 'advanced',
          language: 'English',
          thumbnail_path: 'learning/courses/sire-2/thumbnail.jpg',
          course_format: 'recorded',
          certificate_enabled: true,
          mentor_name: 'Capt. Maya Singh',
          total_lessons: '8',
          completed_lessons: '3',
        }]
      },
    })

    await expect(repository.listLearnerEnrollments(learnerId)).resolves.toEqual([{
      enrollmentId,
      enrollmentStatus: 'active',
      enrolledAt: '2026-09-14T12:00:00.000Z',
      completedAt: null,
      courseId,
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical inspection readiness from a Master Mariner',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      thumbnailPath: 'learning/courses/sire-2/thumbnail.jpg',
      courseFormat: 'recorded',
      certificateEnabled: true,
      mentorName: 'Capt. Maya Singh',
      totalLessons: 8,
      completedLessons: 3,
      progressPercent: 38,
    }])

    expect(seen[0]?.values).toEqual([learnerId])
    expect(seen[0]?.text).toContain('enrollment.learner_id = $1')
    expect(seen[0]?.text).toContain("enrollment.status in ('active', 'completed')")
    expect(seen[0]?.text).toContain('public.learning_progress')
    expect(seen[0]?.text).toContain('public.companies company')
    expect(seen[0]?.text).toContain('company.is_verified = true')
    expect(seen[0]?.text).toContain('order by enrollment.updated_at desc, enrollment.id desc')
  })

  it('allows free enrollment into a verified organization-published course', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createEnrollmentRepository({
      query: async (text: string, values?: readonly unknown[]) => {
        seen.push({ text, values })
        if (text.includes('insert into public.learning_enrollments')) return [enrollmentRow]
        return []
      },
    })

    await expect(repository.enrollFreeCourse(learnerId, courseId)).resolves.toMatchObject({
      enrollmentId,
      status: 'active',
      alreadyEnrolled: false,
    })

    expect(seen[0]?.text).toContain('course.company_id')
    expect(seen[0]?.text).toContain('public.companies company')
    expect(seen[0]?.text).toContain('company.is_verified = true')
  })

  it('lists an organization course using the organization name in the legacy mentorName display field', async () => {
    const repository = createEnrollmentRepository({
      query: async () => [{
        enrollment_id: enrollmentId,
        enrollment_status: 'active',
        enrolled_at: new Date('2026-09-14T12:00:00.000Z'),
        completed_at: null,
        course_id: courseId,
        slug: 'bridge-resource-management',
        title: 'Bridge Resource Management',
        subtitle: null,
        category: 'Leadership',
        level: 'advanced',
        language: 'English',
        thumbnail_path: null,
        course_format: 'recorded',
        certificate_enabled: true,
        mentor_name: 'Sea Academy',
        certificate_id: null,
        certificate_verification_code: null,
        total_lessons: '5',
        completed_lessons: '1',
      }],
    })

    await expect(repository.listLearnerEnrollments(learnerId)).resolves.toEqual([
      expect.objectContaining({
        courseId,
        mentorName: 'Sea Academy',
        progressPercent: 20,
      }),
    ])
  })

})
