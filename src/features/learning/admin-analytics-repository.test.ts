import { describe, expect, it, vi } from 'vitest'
import { createAdminLearningAnalyticsRepository } from './admin-analytics-repository'

describe('admin learning analytics repository', () => {
  it('returns privacy-safe platform learning aggregates for an administrator', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ active_mentor_count: '4' }])
      .mockResolvedValueOnce([
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
    const repository = createAdminLearningAnalyticsRepository({ query })

    const result = await repository.getPlatformAnalytics('admin-1')

    expect(result.summary).toEqual({
      courseCount: 2,
      publishedCourseCount: 1,
      activeMentorCount: 4,
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
    expect(result.courses[0]).toEqual({
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
    })

    const [authorizationSql, authorizationValues] = query.mock.calls[0]
    expect(authorizationSql).toContain('from public.user_roles')
    expect(authorizationSql).toContain("role::text = 'administrator'")
    expect(authorizationValues).toEqual(['admin-1'])

    const [mentorSql] = query.mock.calls[1]
    expect(mentorSql).toContain('from public.learning_mentors')
    expect(mentorSql).toContain("status = 'active'")

    const [analyticsSql] = query.mock.calls[2]
    expect(analyticsSql).toContain("enrollment.status <> 'revoked'")
    expect(analyticsSql).toContain('enrollment_metrics as')
    expect(analyticsSql).toContain('certificate_metrics as')
    expect(analyticsSql).toContain('assignment_metrics as')
    expect(result.courses[0]).not.toHaveProperty('learnerId')
    expect(result.courses[0]).not.toHaveProperty('learnerName')
    expect(result.courses[0]).not.toHaveProperty('learnerEmail')
    expect(result.courses[0]).not.toHaveProperty('responseText')
  })

  it('rejects a non-administrator before reading learning analytics', async () => {
    const query = vi.fn().mockResolvedValueOnce([])
    const repository = createAdminLearningAnalyticsRepository({ query })

    await expect(repository.getPlatformAnalytics('member-1')).rejects.toThrow('admin_forbidden')
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('normalizes an empty platform portfolio to zero metrics', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ allowed: true }])
      .mockResolvedValueOnce([{ active_mentor_count: '0' }])
      .mockResolvedValueOnce([])
    const repository = createAdminLearningAnalyticsRepository({ query })

    const result = await repository.getPlatformAnalytics('admin-1')

    expect(result.summary).toEqual({
      courseCount: 0,
      publishedCourseCount: 0,
      activeMentorCount: 0,
      enrollmentCount: 0,
      activeEnrollmentCount: 0,
      completedEnrollmentCount: 0,
      completionRate: 0,
      averageProgress: 0,
      certificateCount: 0,
      pendingAssignmentCount: 0,
      passedAssignmentCount: 0,
      revisionAssignmentCount: 0,
    })
    expect(result.courses).toEqual([])
  })
})
