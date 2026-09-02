import { describe, expect, it } from 'vitest'
import { relationshipFromRows } from './queries'
import type { NetworkConnectionRow } from './types'

const viewerId = '11111111-1111-4111-8111-111111111111'
const targetId = '22222222-2222-4222-8222-222222222222'

function connection(overrides: Partial<NetworkConnectionRow> = {}): NetworkConnectionRow {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    user_low_id: viewerId,
    user_high_id: targetId,
    requested_by: viewerId,
    status: 'pending',
    created_at: '2026-09-02T10:00:00.000Z',
    updated_at: '2026-09-02T10:00:00.000Z',
    ...overrides,
  }
}

describe('relationshipFromRows', () => {
  it('returns no connection for unrelated profiles', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [])).toEqual({
      following: false,
      connection: { kind: 'none', connectionId: null },
    })
  })

  it('keeps follow state independent from connection state', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set([targetId]), [])).toEqual({
      following: true,
      connection: { kind: 'none', connectionId: null },
    })
  })

  it('identifies an outgoing pending request', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection()])).toEqual({
      following: false,
      connection: { kind: 'outgoing_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })

  it('identifies an incoming pending request', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection({ requested_by: targetId })])).toEqual({
      following: false,
      connection: { kind: 'incoming_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })

  it('identifies an accepted connection without forcing follow state', () => {
    expect(relationshipFromRows(viewerId, targetId, new Set(), [connection({ status: 'accepted' })])).toEqual({
      following: false,
      connection: { kind: 'connected', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
    })
  })
})
