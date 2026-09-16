import { describe, expect, it, vi } from 'vitest'
import { createMentorAnalyticsRepository } from './mentor-analytics-repository'

describe('mentor analytics repository', () => {
  it('maps owned-course aggregates into a privacy-safe portfolio summary', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        course_id: 'course-1',
        slug: 'sire-2-readiness',
        title: 'SIRE 2.0 Readiness',
        status: 'published',
        enrollment_count: '6',
        active_enrollment_count: '4',
        completed_enrollment_count: '2',
        average_progress: '55',
        certificate_count: '2',
        pending_assignment_count: '2',
        passed_assignment_count: '3',
        revision_assignment_count: '1',
      },
      {
        course_id: 'course-2',
        slug: 'bridge-leadership',
        title: 'Bridge Leadership',
        status: 'approved',
        enrollment_count: '4',
        active_enrollment_count: '2',
        completed_enrollment_count: '2',
        average_progress: '70',
        certificate_count: '1',
        pending_assignment_count: '0',
        passed_assignment_count: '2',
        revision_assignment_count: '0',
      },
    ])
    const repository = createMentorAnalyticsRepository({ query })

    const result = await repository.getForMentor('mentor-user-1')

    expect(result.summary).toEqual({
      courseCount: 2,
      publishedCourseCount: 1,
      enrollmentCount: 10,
      activeEnrollmentCount: 6,
      completedEnrollmentCount: 4,
      completionRate: 40,
      averageProgress: 61,
      certificateCount: 3,
      pendingAssignmentCount: 2,
      passedAssignmentCount: 5,
      revisionAssignmentCount: 1,
    })
    expect(result.courses).toEqual([
      {
        courseId: 'course-1',
        slug: 'sire-2-readiness',
        title: 'SIRE 2.0 Readiness',
        status: 'published',
        enrollmentCount: 6,
        activeEnrollmentCount: 4,
        completedEnrollmentCount: 2,
        completionRate: 33,
        averageProgress: 55,
        certificateCount: 2,
        pendingAssignmentCount: 2,
        passedAssignmentCount: 3,
        revisionAssignmentCount: 1,
      },
      {
        courseId: 'course-2',
        slug: 'bridge-leadership',
        title: 'Bridge Leadership',
        status: 'approved',
        enrollmentCount: 4,
        activeEnrollmentCount: 2,
        completedEnrollmentCount: 2,
        completionRate: 50,
        averageProgress: 70,
        certificateCount: 1,
        pendingAssignmentCount: 0,
        passedAssignmentCount: 2,
        revisionAssignmentCount: 0,
      },
    ])

    const [sql, values] = query.mock.calls[0]
    expect(sql).toContain('mentor.user_id = $1')
    expect(sql).toContain("mentor.status = 'active'")
    expect(sql).toContain("enrollment.status <> 'revoked'")
    expect(sql).toContain('enrollment_metrics as')
    expect(sql).toContain('certificate_metrics as')
    expect(sql).toContain('assignment_metrics as')
    expect(values).toEqual(['mentor-user-1'])
    expect(result.courses[0]).not.toHaveProperty('learnerId')
    expect(result.courses[0]).not.toHaveProperty('learnerName')
  })

  it('normalizes an owned course with no learning activity to zero metrics', async () => {
    const query = vi.fn().mockResolvedValue([
      {
        course_id: 'course-empty',
        slug: 'new-course',
        title: 'New Course',
        status: 'draft',
        enrollment_count: '0',
        active_enrollment_count: '0',
        completed_enrollment_count: '0',
        average_progress: '0',
        certificate_count: '0',
        pending_assignment_count: '0',
        passed_assignment_count: '0',
        revision_assignment_count: '0',
      },
    ])
    const repository = createMentorAnalyticsRepository({ query })

    const result = await repository.getForMentor('mentor-user-1')

    expect(result.summary.enrollmentCount).toBe(0)
    expect(result.summary.completionRate).toBe(0)
    expect(result.summary.averageProgress).toBe(0)
    expect(result.courses[0]?.completionRate).toBe(0)
    expect(result.courses[0]?.averageProgress).toBe(0)
  })
})