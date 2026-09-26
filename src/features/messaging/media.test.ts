import { beforeEach, describe, expect, it, vi } from 'vitest'

const storage = vi.hoisted(() => ({
  headMediaObject: vi.fn(),
  createMediaReadUrl: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  deleteMediaObject: vi.fn(),
  readMediaObjectPrefix: vi.fn(),
  createMediaDownloadUrl: vi.fn(),
}))

vi.mock('@/lib/aws/storage', () => storage)

import { verifyPendingMessageAttachment } from './media'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const OBJECT_ID = '33333333-3333-4333-8333-333333333333'

describe('message attachment verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storage.readMediaObjectPrefix.mockResolvedValue(new TextEncoder().encode('Certificate of Competency'))
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

  it('rejects and removes an upload whose bytes do not match the declared photo type', async () => {
    storage.headMediaObject.mockResolvedValue({ contentType: 'image/png', contentLength: 64 })
    storage.readMediaObjectPrefix.mockResolvedValue(new TextEncoder().encode('<html><script>steal()</script></html>'))
    const storagePath = `messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.png`

    await expect(verifyPendingMessageAttachment({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath,
      name: 'bridge.png',
      mimeType: 'image/png',
      size: 64,
    })).rejects.toThrow('messaging_attachment_content_mismatch')
    expect(storage.readMediaObjectPrefix).toHaveBeenCalledWith(storagePath, 64)
    expect(storage.deleteMediaObject).toHaveBeenCalledWith(storagePath)
  })

  it('removes an upload whose stored size differs from what was declared', async () => {
    storage.headMediaObject.mockResolvedValue({ contentType: 'image/png', contentLength: 999_999 })
    const storagePath = `messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.png`

    await expect(verifyPendingMessageAttachment({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath,
      name: 'bridge.png',
      mimeType: 'image/png',
      size: 64,
    })).rejects.toThrow('messaging_attachment_metadata_mismatch')
    expect(storage.deleteMediaObject).toHaveBeenCalledWith(storagePath)
  })

  it('refuses an attachment stored under another member or conversation', async () => {
    await expect(verifyPendingMessageAttachment({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath: `messages/44444444-4444-4444-8444-444444444444/${CONVERSATION_ID}/${OBJECT_ID}.png`,
      name: 'bridge.png',
      mimeType: 'image/png',
      size: 64,
    })).rejects.toThrow('messaging_attachment_reference_invalid')
    expect(storage.headMediaObject).not.toHaveBeenCalled()
  })

  it('signs a short-lived read URL that pins type and disposition', async () => {
    storage.createMediaDownloadUrl.mockResolvedValue('https://signed.example/file')
    const { createMessageAttachmentReadUrl, MESSAGE_ATTACHMENT_READ_URL_SECONDS } = await import('./media')
    const storagePath = `messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.png`

    await createMessageAttachmentReadUrl({ storagePath, name: 'bridge.png', mimeType: 'image/png' })
    expect(storage.createMediaDownloadUrl).toHaveBeenLastCalledWith({
      key: storagePath,
      contentType: 'image/png',
      contentDisposition: expect.stringMatching(/^inline; filename="bridge\.png"/),
      expiresInSeconds: MESSAGE_ATTACHMENT_READ_URL_SECONDS,
    })
    expect(MESSAGE_ATTACHMENT_READ_URL_SECONDS).toBeLessThanOrEqual(300)

    await createMessageAttachmentReadUrl({ storagePath, name: 'bridge.png', mimeType: 'image/png', download: true })
    expect(storage.createMediaDownloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({
      contentDisposition: expect.stringMatching(/^attachment; /),
    }))

    await createMessageAttachmentReadUrl({ storagePath: storagePath.replace('.png', '.pdf'), name: 'coc.pdf', mimeType: 'application/pdf' })
    expect(storage.createMediaDownloadUrl).toHaveBeenLastCalledWith(expect.objectContaining({
      contentDisposition: expect.stringMatching(/^attachment; /),
    }))
  })
})
