import { describe, expect, it } from 'vitest'
import { collapseRepeatedNotifications } from './grouping'
import type { NetworkNotification } from './types'

function notification(id: string, createdAt: string, overrides: Partial<NetworkNotification> = {}): NetworkNotification {
  return {
    id,
    type: 'learning_course_approved',
    createdAt,
    readAt: null,
    actor: null,
    message: 'Sea N Shore approved your changes to Placeholder Course. Learners see them now.',
    destination: '/learn/teach/courses/course-1',
    ...overrides,
  }
}

describe('collapseRepeatedNotifications (Round H, H2)', () => {
  it('shows the same approval written three times as one row that marks all three read', () => {
    const rows = [
      notification('n3', '2026-10-17T10:02:00.000Z'),
      notification('n2', '2026-10-17T10:01:00.000Z', { readAt: '2026-10-17T10:05:00.000Z' }),
      notification('n1', '2026-10-17T10:00:00.000Z'),
    ]
    const collapsed = collapseRepeatedNotifications(rows)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]).toMatchObject({ id: 'n3', groupIds: ['n3', 'n2', 'n1'], readAt: null })
  })

  it('keeps different courses, different messages and repeats more than a day apart as separate rows', () => {
    const rows = [
      notification('a', '2026-10-17T10:00:00.000Z'),
      notification('b', '2026-10-17T09:00:00.000Z', { destination: '/learn/teach/courses/course-2' }),
      notification('c', '2026-10-17T08:00:00.000Z', { message: 'Sea N Shore approved your course.' }),
      notification('d', '2026-10-15T08:00:00.000Z'),
    ]
    expect(collapseRepeatedNotifications(rows).map((row) => row.id)).toEqual(['a', 'b', 'c', 'd'])
  })

  it('never merges notifications from different people', () => {
    const rows = [
      notification('a', '2026-10-17T10:00:00.000Z', { type: 'connection_request', actor: { id: 'p1', fullName: 'Member A', avatarUrl: null } as never, message: 'sent you a connection request', destination: '/network' }),
      notification('b', '2026-10-17T09:59:00.000Z', { type: 'connection_request', actor: { id: 'p2', fullName: 'Member B', avatarUrl: null } as never, message: 'sent you a connection request', destination: '/network' }),
    ]
    expect(collapseRepeatedNotifications(rows)).toHaveLength(2)
  })
})
