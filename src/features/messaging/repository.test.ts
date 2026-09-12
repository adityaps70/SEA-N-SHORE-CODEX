import { describe, expect, it, vi } from 'vitest'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const TARGET_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '44444444-4444-4444-8444-444444444444'
const MESSAGE_ID = '55555555-5555-4555-8555-555555555555'
const CLIENT_MESSAGE_ID = '66666666-6666-4666-8666-666666666666'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

describe('Aurora messaging repository', () => {
  it('uses canonical pair ordering for direct-conversation lookup and creation', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: CONVERSATION_ID }])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await repository.findDirectConversationByPair(TARGET_ID, VIEWER_ID)
    await repository.insertDirectConversation(TARGET_ID, VIEWER_ID)

    const [low, high] = [VIEWER_ID, TARGET_ID].sort()
    expect(query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('direct_user_low_id = $1 and direct_user_high_id = $2'),
      [low, high],
    )
    expect(query).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/insert into public\.conversations[\s\S]+conversation_participants/i),
      [low, high],
    )
  })

  it('checks conversation membership with a parameterized participant query', async () => {
    const query = vi.fn(async () => [{ allowed: true }])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await expect(repository.isParticipant(VIEWER_ID, CONVERSATION_ID)).resolves.toBe(true)

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('from public.conversation_participants'),
      [CONVERSATION_ID, VIEWER_ID],
    )
  })

  it('looks up retry idempotency by sender and client message id', async () => {
    const query = vi.fn(async () => [])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await repository.findMessageByClientId(VIEWER_ID, CLIENT_MESSAGE_ID)

    const [sql, values] = callsOf(query)[0] ?? []
    expect(String(sql)).toContain('from public.messages')
    expect(String(sql)).toContain('sender_profile_id = $1')
    expect(String(sql)).toContain('client_message_id = $2')
    expect(values).toEqual([VIEWER_ID, CLIENT_MESSAGE_ID])
  })

  it('persists a message with explicit conversation, sender, client id and normalized body', async () => {
    const query = vi.fn(async () => [{
      id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      sender_profile_id: VIEWER_ID,
      client_message_id: CLIENT_MESSAGE_ID,
      body: 'Good day, Captain.',
      created_at: '2026-09-13T00:01:00.000Z',
      edited_at: null,
      deleted_at: null,
    }])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await repository.insertMessage({
      conversationId: CONVERSATION_ID,
      senderProfileId: VIEWER_ID,
      clientMessageId: CLIENT_MESSAGE_ID,
      body: 'Good day, Captain.',
    })

    const [sql, values] = callsOf(query)[0] ?? []
    expect(String(sql)).toContain('insert into public.messages')
    expect(values).toEqual([
      CONVERSATION_ID,
      VIEWER_ID,
      CLIENT_MESSAGE_ID,
      'Good day, Captain.',
    ])
  })

  it('loads thread history through participant authorization and a stable created_at/id cursor', async () => {
    const query = vi.fn(async () => [])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await repository.listMessageRows({
      viewerProfileId: VIEWER_ID,
      conversationId: CONVERSATION_ID,
      cursor: {
        createdAt: '2026-09-13T00:01:00.000Z',
        id: MESSAGE_ID,
      },
      limit: 31,
    })

    const [sql, values] = callsOf(query)[0] ?? []
    const text = String(sql).toLowerCase()
    expect(text).toContain('from public.messages')
    expect(text).toContain('conversation_participants')
    expect(text).toContain('m.created_at <')
    expect(text).toContain('m.created_at =')
    expect(text).toContain('m.id <')
    expect(text).toContain('order by m.created_at desc, m.id desc')
    expect(values).toEqual([
      CONVERSATION_ID,
      VIEWER_ID,
      '2026-09-13T00:01:00.000Z',
      MESSAGE_ID,
      31,
    ])
  })

  it('advances read state monotonically instead of allowing an older message to move it backwards', async () => {
    const query = vi.fn(async () => [{ advanced: true }])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await expect(repository.advanceReadState(
      VIEWER_ID,
      CONVERSATION_ID,
      MESSAGE_ID,
      '2026-09-13T00:01:00.000Z',
    )).resolves.toBe(true)

    const [sql, values] = callsOf(query)[0] ?? []
    const text = String(sql).toLowerCase()
    expect(text).toContain('update public.conversation_participants')
    expect(text).toContain('last_read_message_id')
    expect(text).toContain('last_read_at')
    expect(text).toMatch(/last_read_at\s+is\s+null|coalesce/)
    expect(values).toEqual([
      CONVERSATION_ID,
      VIEWER_ID,
      MESSAGE_ID,
      '2026-09-13T00:01:00.000Z',
    ])
  })

  it('builds inbox rows only from conversations in which the viewer is a participant', async () => {
    const query = vi.fn(async () => [])
    const { createMessagingRepository } = await import('./repository')
    const repository = createMessagingRepository({ query })

    await repository.listInboxRows(VIEWER_ID, { limit: 30 })

    const [sql, values] = callsOf(query)[0] ?? []
    const text = String(sql).toLowerCase()
    expect(text).toContain('conversation_participants')
    expect(text).toContain('last_message_at')
    expect(text).toMatch(/last_read_at|last_read_message_id/)
    expect(text).toContain('order by')
    expect(values).toEqual([VIEWER_ID, 30])
  })
})
