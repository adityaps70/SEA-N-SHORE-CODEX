import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  canUsePlatformAdminAuthority: vi.fn(),
  exportRoster: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/admin/mfa-gate', () => ({ canUsePlatformAdminAuthority: mocks.canUsePlatformAdminAuthority }))
vi.mock('@/features/learning/course-roster-repository', () => ({ courseRosterRepository: { exportRoster: mocks.exportRoster } }))

import type { RosterLearner } from '@/features/learning/course-roster'
import { GET } from './route'

const courseId = '22222222-2222-4222-8222-222222222222'

const learner: RosterLearner = {
  enrollmentId: '80000000-0000-4000-8000-000000000001',
  learnerId: '90000000-0000-4000-8000-000000000001',
  name: 'Fixture Learner',
  slug: 'fixture-learner',
  rank: 'Fixture Rank',
  enrolledAt: '2026-03-05T06:00:00.000Z',
  source: 'purchase',
  status: 'active',
  accessExpiresAt: null,
  completedLessons: 3,
  totalLessons: 4,
  progressPercent: 75,
  lastActiveAt: '2026-03-10T06:00:00.000Z',
  quizScores: [{ lessonTitle: 'Fixture Quiz', bestPercentage: 90, passed: true }],
  certificate: 'issued',
  batchId: null,
  batchTitle: null,
}

function get(id = courseId) {
  return GET(new Request(`https://seanshore.example/api/learn/courses/${id}/roster`), { params: Promise.resolve({ courseId: id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1', email: 'fixture@example.test' })
  mocks.canUsePlatformAdminAuthority.mockResolvedValue(false)
  mocks.exportRoster.mockResolvedValue({ course: { id: courseId, title: 'Fixture Course', slug: 'fixture-course', openToNewLearners: true }, learners: [learner] })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/learn/courses/[courseId]/roster', () => {
  it('answers a router prefetch or a browser speculative prefetch with an empty 204 and exports nothing (owner 21 Nov)', async () => {
    for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }] as Record<string, string>[]) {
      const response = await GET(new Request(`https://seanshore.example/api/learn/courses/${courseId}/roster`, { headers }), { params: Promise.resolve({ courseId }) })
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(await response.text()).toBe('')
    }
    expect(mocks.getVerifiedUser).not.toHaveBeenCalled()
    expect(mocks.canUsePlatformAdminAuthority).not.toHaveBeenCalled()
    expect(mocks.exportRoster).not.toHaveBeenCalled()
  })

  it('asks signed-out visitors to sign in before reading anything', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await get()

    expect(response.status).toBe(401)
    expect(await response.text()).toBe('Sign in to export your learners.')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.exportRoster).not.toHaveBeenCalled()
  })

  it('is not found for a course id that is not a UUID', async () => {
    const response = await get('not-a-course')
    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.exportRoster).not.toHaveBeenCalled()
  })

  it('is not found for a course the user does not manage', async () => {
    mocks.exportRoster.mockRejectedValue(new Error('course_not_found'))
    const response = await get()
    expect(response.status).toBe(404)
    expect(await response.text()).toBe('Not found')
    expect(console.error).not.toHaveBeenCalled()
  })

  it('downloads the roster as a private CSV attachment', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-10T08:00:00.000Z'))

    const response = await get()

    expect(response.status).toBe(200)
    expect(mocks.exportRoster).toHaveBeenCalledWith({ actorId: 'user-1', courseId, allCourses: false, batchId: null })
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="sea-n-shore-learners-fixture-course-2026-10-10.csv"')
    const csv = await response.text()
    expect(csv.startsWith('Name,Rank,Enrolled,How,Status,Progress %')).toBe(true)
    expect(csv).toContain('Fixture Learner,Fixture Rank,2026-03-05,Bought,Learning,75,3 of 4,2026-03-10,Fixture Quiz: 90% (passed),Issued,Lifetime')
  })

  it('exports any course for a platform administrator and keeps the file name safe', async () => {
    mocks.canUsePlatformAdminAuthority.mockResolvedValue(true)
    mocks.exportRoster.mockResolvedValue({ course: { id: courseId, title: 'Fixture', slug: '"; evil/../name', openToNewLearners: true }, learners: [] })

    const response = await get()

    expect(mocks.exportRoster).toHaveBeenCalledWith({ actorId: 'user-1', courseId, allCourses: true, batchId: null })
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="sea-n-shore-learners-evilname-\d{4}-\d{2}-\d{2}\.csv"$/)
  })

  it('falls back to "course" when the slug has no safe characters', async () => {
    mocks.exportRoster.mockResolvedValue({ course: { id: courseId, title: 'Fixture', slug: '///', openToNewLearners: true }, learners: [] })
    const response = await get()
    expect(response.headers.get('content-disposition')).toMatch(/filename="sea-n-shore-learners-course-/)
  })

  it('returns 500 for an unexpected failure and logs no personal data', async () => {
    mocks.exportRoster.mockRejectedValue(new Error('fixture@example.test Fixture Learner leaked in message'))

    const response = await get()

    expect(response.status).toBe(500)
    expect(await response.text()).toBe('The export could not be created. Please try again.')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(console.error).toHaveBeenCalledWith('[course_roster_export_failed]', { error: 'Error' })
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls)
    expect(logged).not.toContain('fixture@example.test')
    expect(logged).not.toContain('Fixture Learner')
    expect(logged).not.toContain('user-1')
  })
})
