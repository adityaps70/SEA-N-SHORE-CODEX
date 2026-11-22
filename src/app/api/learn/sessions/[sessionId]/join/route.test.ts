import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  sessionViewer: vi.fn(),
  getForViewer: vi.fn(),
  recordJoin: vi.fn(),
}))

vi.mock('@/features/learning/sessions/session-viewer', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/learning/sessions/session-viewer')>()),
  sessionViewer: mocks.sessionViewer,
}))
vi.mock('@/features/learning/sessions/session-repository', () => ({
  sessionRepository: { getForViewer: mocks.getForViewer, recordJoin: mocks.recordJoin },
}))

import { GET } from './route'

const sessionId = '33333333-3333-4333-8333-333333333333'
const enrollmentId = '44444444-4444-4444-8444-444444444444'

function get(headers: Record<string, string> = {}, id = sessionId) {
  return GET(new Request(`https://seanshore.example/api/learn/sessions/${id}/join`, { headers }), { params: Promise.resolve({ sessionId: id }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-10T08:05:00.000Z'))
  mocks.sessionViewer.mockResolvedValue({ actorId: 'learner-1', allCourses: false })
  mocks.getForViewer.mockResolvedValue({
    courseSlug: 'fixture-course',
    enrollmentId,
    session: {
      id: sessionId,
      batchId: 'batch-1',
      seriesId: null,
      title: 'Fixture Session',
      description: null,
      startsAt: '2026-10-10T08:00:00.000Z',
      durationMinutes: 60,
      meetingUrl: 'https://meet.example.test/fixture',
      status: 'scheduled',
      recording: null,
    },
  })
  mocks.recordJoin.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('GET /api/learn/sessions/[sessionId]/join', () => {
  it('answers a router prefetch or a browser speculative prefetch with an empty 204 and records nothing (owner 21 Nov)', async () => {
    for (const headers of [{ rsc: '1' }, { 'next-router-prefetch': '1' }, { 'sec-purpose': 'prefetch' }, { purpose: 'prefetch' }] as Record<string, string>[]) {
      const response = await get(headers)
      expect(response.status).toBe(204)
      expect(response.headers.get('cache-control')).toBe('private, no-store')
      expect(response.headers.get('location')).toBeNull()
      expect(await response.text()).toBe('')
    }
    expect(mocks.sessionViewer).not.toHaveBeenCalled()
    expect(mocks.getForViewer).not.toHaveBeenCalled()
    expect(mocks.recordJoin).not.toHaveBeenCalled()
  })

  it('records the join and sends a learner to the meeting link while Join is open', async () => {
    const response = await get()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://meet.example.test/fixture')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.getForViewer).toHaveBeenCalledWith({ actorId: 'learner-1', allCourses: false }, sessionId)
    expect(mocks.recordJoin).toHaveBeenCalledWith('learner-1', enrollmentId, sessionId)
  })

  it('sends a signed-out visitor to sign in without reading the session', async () => {
    mocks.sessionViewer.mockResolvedValue(null)
    const response = await get()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/auth/sign-in')
    expect(mocks.getForViewer).not.toHaveBeenCalled()
    expect(mocks.recordJoin).not.toHaveBeenCalled()
  })

  it('is not found for a session id that is not a UUID', async () => {
    const response = await get({}, 'not-a-session')
    expect(response.status).toBe(404)
    expect(mocks.getForViewer).not.toHaveBeenCalled()
  })

  it('returns a learner to the Sessions tab, recording nothing, before Join opens', async () => {
    vi.setSystemTime(new Date('2026-10-10T07:00:00.000Z'))
    const response = await get()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/learn/courses/fixture-course/learn?tab=sessions&join=not_yet')
    expect(mocks.recordJoin).not.toHaveBeenCalled()
  })
})
