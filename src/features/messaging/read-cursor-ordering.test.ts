import { describe, expect, it, vi } from 'vitest'
import { createMessagingRepository } from './repository'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555'

type QueryCall = [text: string, values?: readonly unknown[]]

function firstCall(query: { mock: { calls: unknown[] } }) {
  return query.mock.calls[0] as unknown as QueryCall
}

describe('messaging durable read cursor ordering', () => {
  it('advances by the same created_at/id tuple used to order messages', async () => {
    const query = vi.fn(async () => [{ advanced: true }])
    const repository = createMessagingRepository({ query })

    await repository.advanceReadState(
      VIEWER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
      '2026-09-13T10:00:00.000Z',
    )

    const [sql] = firstCall(query)
    const text = sql.toLowerCase()
    expect(text).toContain('from public.messages target')
    expect(text).toContain('last_read_at = target.created_at')
    expect(text).toContain('current_cursor.created_at < target.created_at')
    expect(text).toContain('current_cursor.created_at = target.created_at')
    expect(text).toContain('current_cursor.id < target.id')
    expect(text).not.toContain('$4::timestamptz')
  })

  it('exposes the peer read cursor alongside incoming-only unread state', async () => {
    const query = vi.fn(async () => [])
    const repository = createMessagingRepository({ query })

    await repository.listInboxRows(VIEWER_ID, { limit: 30 })

    const [sql] = firstCall(query)
    const text = sql.toLowerCase()
    expect(text).toContain('other.last_read_message_id as other_last_read_message_id')
    expect(text).toContain('other.last_read_at as other_last_read_at')
    expect(text).toContain('from public.messages unread_message')
    expect(text).toContain('unread_message.sender_profile_id <> mine.profile_id')
  })

  it('derives inbox unread state from unread incoming messages, never from the viewer\'s own latest message', async () => {
    const query = vi.fn(async () => [])
    const repository = createMessagingRepository({ query })

    await repository.listInboxRows(VIEWER_ID, { limit: 30 })

    const [sql] = firstCall(query)
    const text = sql.toLowerCase()
    expect(text).toContain('exists (')
    expect(text).toContain('from public.messages unread_message')
    expect(text).toContain('unread_message.sender_profile_id <> mine.profile_id')
    expect(text).toContain('unread_message.deleted_at is null')
    expect(text).toContain('left join public.messages read_cursor')
    expect(text).toContain('unread_message.created_at = read_cursor.created_at')
    expect(text).toContain('unread_message.id > read_cursor.id')
    expect(text).not.toContain('unread_message.created_at = mine.last_read_at')
  })

  it('counts every unread incoming message after the durable cursor, not unread conversations', async () => {
    const query = vi.fn(async () => [{ count: 0 }])
    const repository = createMessagingRepository({ query })

    await repository.countUnreadMessages(VIEWER_ID)

    const [sql] = firstCall(query)
    const text = sql.toLowerCase()
    expect(text).toContain('select count(*)::int as count')
    expect(text).toContain('from public.messages unread_message')
    expect(text).toContain('join public.conversation_participants mine')
    expect(text).toContain('unread_message.sender_profile_id <> mine.profile_id')
    expect(text).toContain('unread_message.deleted_at is null')
    expect(text).toContain('left join public.messages read_cursor')
    expect(text).toContain('unread_message.created_at = read_cursor.created_at')
    expect(text).toContain('unread_message.id > read_cursor.id')
    expect(text).not.toContain('unread_message.created_at = mine.last_read_at')
    expect(text).not.toContain('exists (')
  })
})
