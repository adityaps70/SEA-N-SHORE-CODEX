import { describe, expect, it } from 'vitest'
import {
  buildMessageAttachmentStoragePath,
  isOwnedMessageAttachmentStoragePath,
  validateMessageAttachmentMetadata,
} from './media-policy'

const PROFILE_ID = '11111111-1111-4111-8111-111111111111'
const CONVERSATION_ID = '22222222-2222-4222-8222-222222222222'
const OBJECT_ID = '33333333-3333-4333-8333-333333333333'

describe('messaging attachment media policy', () => {
  it('accepts common photos, videos and professional documents with bounded sizes', () => {
    expect(validateMessageAttachmentMetadata({ mimeType: 'image/jpeg', size: 1024, name: 'bridge.jpg' }).ok).toBe(true)
    expect(validateMessageAttachmentMetadata({ mimeType: 'video/mp4', size: 5 * 1024 * 1024, name: 'inspection.mp4' }).ok).toBe(true)
    expect(validateMessageAttachmentMetadata({ mimeType: 'application/pdf', size: 2048, name: 'certificate.pdf' }).ok).toBe(true)
    expect(validateMessageAttachmentMetadata({ mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 2048, name: 'cv.docx' }).ok).toBe(true)
  })

  it('rejects executable and oversized attachments', () => {
    expect(validateMessageAttachmentMetadata({ mimeType: 'application/x-msdownload', size: 2048, name: 'bad.exe' }).ok).toBe(false)
    expect(validateMessageAttachmentMetadata({ mimeType: 'application/pdf', size: 26 * 1024 * 1024, name: 'huge.pdf' }).ok).toBe(false)
    expect(validateMessageAttachmentMetadata({ mimeType: 'video/mp4', size: 101 * 1024 * 1024, name: 'huge.mp4' }).ok).toBe(false)
  })

  it('builds and verifies an owner-scoped messages storage path', () => {
    const path = buildMessageAttachmentStoragePath({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      mimeType: 'image/jpeg',
      objectId: OBJECT_ID,
    })
    expect(path).toBe(`messages/${PROFILE_ID}/${CONVERSATION_ID}/${OBJECT_ID}.jpg`)
    expect(isOwnedMessageAttachmentStoragePath({
      profileId: PROFILE_ID,
      conversationId: CONVERSATION_ID,
      storagePath: path,
      mimeType: 'image/jpeg',
    })).toBe(true)
    expect(isOwnedMessageAttachmentStoragePath({
      profileId: '44444444-4444-4444-8444-444444444444',
      conversationId: CONVERSATION_ID,
      storagePath: path,
      mimeType: 'image/jpeg',
    })).toBe(false)
  })
})
