import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  headMediaObject: vi.fn(),
  createMediaReadUrl: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  deleteMediaObject: vi.fn(),
}))

vi.mock('@/lib/aws/storage', () => storage)

import { verifyPendingMessageAttachment } from './media'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const OBJECT_ID = '33333333-3333-4333-8333-333333333333'

describe('message attachment verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('accepts an equivalent textual S3 content type with a charset parameter', async () => {
    storage.headMediaObject.mockResolvedValue({
      contentType: 'text/plain; charset=UTF-8',
      contentLength: 35,
    })

    await expect(verifyPendingMessageAttachment({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath: `messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.txt`,
      name: 'certificate.txt',
      mimeType: 'text/plain',
      size: 35,
    })).resolves.toMatchObject({
      mimeType: 'text/plain',
      size: 35,
      name: 'certificate.txt',
    })
  })

  it('still rejects a different stored media type', async () => {
    storage.headMediaObject.mockResolvedValue({
      contentType: 'application/octet-stream',
      contentLength: 35,
    })

    await expect(verifyPendingMessageAttachment({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath: `messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.txt`,
      name: 'certificate.txt',
      mimeType: 'text/plain',
      size: 35,
    })).rejects.toThrow('messaging_attachment_metadata_mismatch')
  })
})
