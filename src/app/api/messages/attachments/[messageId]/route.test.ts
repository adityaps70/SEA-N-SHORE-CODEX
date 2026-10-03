import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  class AwsAuthenticationRequiredError extends Error {
    constructor() {
      super('Authentication required.')
      this.name = 'AwsAuthenticationRequiredError'
    }
  }
  return {
    AwsAuthenticationRequiredError,
    requireAwsUser: vi.fn(),
    findMessageAccessibleToParticipant: vi.fn(),
    createMessageAttachmentReadUrl: vi.fn(),
  }
})

vi.mock('@/features/auth/aws-queries', () => ({
  AwsAuthenticationRequiredError: mocks.AwsAuthenticationRequiredError,
  requireAwsUser: mocks.requireAwsUser,
}))
vi.mock('@/features/messaging/repository', () => ({
  messagingRepository: {
    findMessageAccessibleToParticipant: mocks.findMessageAccessibleToParticipant,
  },
}))
vi.mock('@/features/messaging/media', () => ({
  createMessageAttachmentReadUrl: mocks.createMessageAttachmentReadUrl,
}))

import { GET } from './route'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const SENDER_ID = '22222222-2222-4222-8222-222222222222'
const CONVERSATION_ID = '33333333-3333-4333-8333-333333333333'
const MESSAGE_ID = '44444444-4444-4444-8444-444444444444'
const OBJECT_ID = '55555555-5555-4555-8555-555555555555'
const STORAGE_PATH = `messages/${SENDER_ID}/${CONVERSATION_ID}/${OBJECT_ID}.pdf`

function request(query = '') {
  return GET(
    new Request(`https://seanshore.example/api/messages/attachments/${MESSAGE_ID}${query}`),
    { params: Promise.resolve({ messageId: MESSAGE_ID }) },
  )
}

describe('GET /api/messages/attachments/[messageId]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: VIEWER_ID })
    mocks.findMessageAccessibleToParticipant.mockResolvedValue({
      id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      sender_profile_id: SENDER_ID,
      client_message_id: '66666666-6666-4666-8666-666666666666',
      body: '',
      attachment_storage_path: STORAGE_PATH,
      attachment_name: 'coc.pdf',
      attachment_mime_type: 'application/pdf',
      attachment_size: 4096,
      created_at: '2026-09-20T10:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    })
    mocks.createMessageAttachmentReadUrl.mockResolvedValue('https://bucket.example/coc.pdf?X-Amz-Expires=300')
  })

  it('lets the browser keep an inline photo redirect for half an hour', async () => {
    mocks.findMessageAccessibleToParticipant.mockResolvedValueOnce({
      id: MESSAGE_ID,
      conversation_id: CONVERSATION_ID,
      sender_profile_id: SENDER_ID,
      client_message_id: '66666666-6666-4666-8666-666666666666',
      body: '',
      attachment_storage_path: STORAGE_PATH.replace('.pdf', '.jpg'),
      attachment_name: 'bridge.jpg',
      attachment_mime_type: 'image/jpeg',
      attachment_size: 4096,
      created_at: '2026-09-20T10:00:00.000Z',
      edited_at: null,
      deleted_at: null,
    })
    mocks.createMessageAttachmentReadUrl.mockResolvedValueOnce('https://bucket.example/bridge.jpg?X-Amz-Expires=7200')

    const response = await request()

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://bucket.example/bridge.jpg?X-Amz-Expires=7200')
    expect(response.headers.get('cache-control')).toBe('private, max-age=1800')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(mocks.createMessageAttachmentReadUrl).toHaveBeenCalledWith({
      storagePath: STORAGE_PATH.replace('.pdf', '.jpg'),
      name: 'bridge.jpg',
      mimeType: 'image/jpeg',
      download: false,
    })
  })

  it('never caches a non-media attachment redirect', async () => {
    const response = await request()

    expect(response.status).toBe(302)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('redirects a participant download to a short-lived signed URL and is never cached', async () => {
    const response = await request('?download=1')

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://bucket.example/coc.pdf?X-Amz-Expires=300')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(mocks.findMessageAccessibleToParticipant).toHaveBeenCalledWith(VIEWER_ID, MESSAGE_ID)
    expect(mocks.createMessageAttachmentReadUrl).toHaveBeenCalledWith({
      storagePath: STORAGE_PATH,
      name: 'coc.pdf',
      mimeType: 'application/pdf',
      download: true,
    })
  })

  it('returns 404 without a storage URL for someone outside the conversation', async () => {
    mocks.findMessageAccessibleToParticipant.mockResolvedValueOnce(null)

    const response = await request()

    expect(response.status).toBe(404)
    expect(response.headers.get('location')).toBeNull()
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(await response.json()).toEqual({ error: 'This attachment is not available.' })
    expect(mocks.createMessageAttachmentReadUrl).not.toHaveBeenCalled()
  })

  it('returns 401 when signed out', async () => {
    mocks.requireAwsUser.mockRejectedValueOnce(new mocks.AwsAuthenticationRequiredError())

    const response = await request()

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Please sign in to view this attachment.' })
    expect(mocks.findMessageAccessibleToParticipant).not.toHaveBeenCalled()
  })
})
