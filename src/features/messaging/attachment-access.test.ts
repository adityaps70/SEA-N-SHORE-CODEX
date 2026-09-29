import { describe, expect, it, vi } from 'vitest'
import { createMessageAttachmentAccess } from './attachment-access'
import type { MessagingMessageRow } from './types'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const SENDER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const OBJECT_ID = '55555555-5555-4555-8555-555555555555'

class AuthError extends Error {}

function row(overrides: Partial<MessagingMessageRow> = {}): MessagingMessageRow {
  return {
    id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    sender_profile_id: SENDER_ID,
    client_message_id: '66666666-6666-4666-8666-666666666666',
    body: '',
    attachment_storage_path: `messages/${SENDER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.jpg`,
    attachment_name: 'bridge.jpg',
    attachment_mime_type: 'image/jpeg',
    attachment_size: '2048',
    created_at: '2026-09-20T10:00:00.000Z',
    edited_at: null,
    deleted_at: null,
    ...overrides,
  }
}

function makeAccess(message: MessagingMessageRow | null = row()) {
  const deps = {
    requireUser: vi.fn(async () => ({ id: VIEWER_ID })),
    isAuthenticationError: (error: unknown) => error instanceof AuthError,
    findMessageForParticipant: vi.fn(async () => message),
    createReadUrl: vi.fn(async () => 'https://bucket.example/signed?X-Amz-Expires=300'),
  }
  return { resolve: createMessageAttachmentAccess(deps), deps }
}

describe('message attachment access', () => {
  it('returns a short-lived signed URL only after a participant check', async () => {
    const { resolve, deps } = makeAccess()

    await expect(resolve({ messageId: MESSAGE_ID, download: false })).resolves.toEqual({
      ok: true,
      url: 'https://bucket.example/signed?X-Amz-Expires=300',
      inline: true,
    })
    expect(deps.findMessageForParticipant).toHaveBeenCalledWith(VIEWER_ID, MESSAGE_ID)
    expect(deps.createReadUrl).toHaveBeenCalledWith({
      storagePath: `messages/${SENDER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.jpg`,
      name: 'bridge.jpg',
      mimeType: 'image/jpeg',
      download: false,
    })
  })

  it('passes the download flag through so files are served as attachments', async () => {
    const { resolve, deps } = makeAccess()
    await expect(resolve({ messageId: MESSAGE_ID, download: true })).resolves.toMatchObject({ ok: true, inline: false })
    expect(deps.createReadUrl).toHaveBeenCalledWith(expect.objectContaining({ download: true }))
  })

  it('reports non-media attachments as not inline even without the download flag', async () => {
    const { resolve } = makeAccess(row({
      attachment_storage_path: `messages/${SENDER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.pdf`,
      attachment_name: 'coc.pdf',
      attachment_mime_type: 'application/pdf',
    }))
    await expect(resolve({ messageId: MESSAGE_ID, download: false })).resolves.toMatchObject({ ok: true, inline: false })
  })

  it('requires a signed-in member', async () => {
    const { resolve, deps } = makeAccess()
    deps.requireUser.mockRejectedValueOnce(new AuthError('Authentication required.'))

    await expect(resolve({ messageId: MESSAGE_ID, download: false })).resolves.toEqual({ ok: false, status: 401 })
    expect(deps.findMessageForParticipant).not.toHaveBeenCalled()
  })

  it('treats a non-participant exactly like a missing attachment', async () => {
    const { resolve, deps } = makeAccess(null)

    await expect(resolve({ messageId: MESSAGE_ID, download: false })).resolves.toEqual({ ok: false, status: 404 })
    expect(deps.createReadUrl).not.toHaveBeenCalled()
  })

  it.each([
    ['a malformed id', 'not-a-uuid', row()],
    ['an unsent message', MESSAGE_ID, row({ deleted_at: '2026-09-20T11:00:00.000Z' })],
    ['a message without an attachment', MESSAGE_ID, row({ attachment_storage_path: null })],
    ['an unsupported stored type', MESSAGE_ID, row({ attachment_mime_type: 'text/html' })],
    ['a path outside the sender and conversation', MESSAGE_ID, row({
      attachment_storage_path: `messages/${VIEWER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.jpg`,
    })],
    ['a path with a mismatched extension', MESSAGE_ID, row({
      attachment_storage_path: `messages/${SENDER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.html`,
    })],
  ])('refuses %s', async (_label, messageId, message) => {
    const { resolve, deps } = makeAccess(message)

    await expect(resolve({ messageId, download: false })).resolves.toEqual({ ok: false, status: 404 })
    expect(deps.createReadUrl).not.toHaveBeenCalled()
  })
})
