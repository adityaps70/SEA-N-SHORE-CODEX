import { describe, expect, it } from 'vitest'
import {
  buildMessageAttachmentStoragePath,
  isOwnedMessageAttachmentStoragePath,
  matchesMessageAttachmentSignature,
  messageAttachmentContentDisposition,
  messageAttachmentRoute,
  validateMessageAttachmentMetadata,
} from './media-policy'

const bytes = (...values: number[]) => new Uint8Array(values)
const text = (value: string) => new TextEncoder().encode(value)

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

  it('accepts files whose content matches the declared type', () => {
    expect(matchesMessageAttachmentSignature('image/jpeg', bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toBe(true)
    expect(matchesMessageAttachmentSignature('image/png', bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00))).toBe(true)
    expect(matchesMessageAttachmentSignature('image/gif', text('GIF89a....'))).toBe(true)
    expect(matchesMessageAttachmentSignature('image/webp', text('RIFF\u0000\u0000\u0000\u0000WEBPVP8 '))).toBe(true)
    expect(matchesMessageAttachmentSignature('video/mp4', bytes(0, 0, 0, 0x18, ...text('ftypmp42')))).toBe(true)
    expect(matchesMessageAttachmentSignature('application/pdf', text('%PDF-1.7\n'))).toBe(true)
    expect(matchesMessageAttachmentSignature('application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes(0x50, 0x4b, 0x03, 0x04))).toBe(true)
    expect(matchesMessageAttachmentSignature('application/msword', bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1))).toBe(true)
    expect(matchesMessageAttachmentSignature('text/csv', text('rank,vessel\nMaster,MT Example\n'))).toBe(true)
  })

  it('rejects renamed or disguised files', () => {
    // An HTML page renamed to .png
    expect(matchesMessageAttachmentSignature('image/png', text('<html><script>alert(1)</script>'))).toBe(false)
    // A Windows executable renamed to .jpg / .pdf / .docx
    const exe = bytes(0x4d, 0x5a, 0x90, 0x00, 0x03)
    expect(matchesMessageAttachmentSignature('image/jpeg', exe)).toBe(false)
    expect(matchesMessageAttachmentSignature('application/pdf', exe)).toBe(false)
    expect(matchesMessageAttachmentSignature('application/vnd.openxmlformats-officedocument.wordprocessingml.document', exe)).toBe(false)
    // Binary content declared as text
    expect(matchesMessageAttachmentSignature('text/plain', exe)).toBe(false)
    expect(matchesMessageAttachmentSignature('text/plain', new Uint8Array())).toBe(false)
    // Types outside the allow-list are never accepted
    expect(matchesMessageAttachmentSignature('image/svg+xml', text('<svg></svg>'))).toBe(false)
  })

  it('serves attachments through the authorised route with a safe file name', () => {
    expect(messageAttachmentRoute(OBJECT_ID)).toBe(`/api/messages/attachments/${OBJECT_ID}`)
    expect(messageAttachmentRoute(OBJECT_ID, { download: true })).toBe(`/api/messages/attachments/${OBJECT_ID}?download=1`)
    const header = messageAttachmentContentDisposition({ name: 'Crew "list"; final\r\n.pdf', disposition: 'attachment' })
    expect(header).toMatch(/^attachment; filename="Crew list final\.pdf"; filename\*=UTF-8''/)
    expect(header).not.toMatch(/[\r\n]/)
    expect(messageAttachmentContentDisposition({ name: 'Überprüfung (1).jpg', disposition: 'inline' }))
      .toBe(`inline; filename="Uberprufung (1).jpg"; filename*=UTF-8''%C3%9Cberpr%C3%BCfung%20%281%29.jpg`)
  })
})
