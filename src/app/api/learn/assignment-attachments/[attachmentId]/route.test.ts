import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAttachmentForViewer: vi.fn(),
  createAssignmentAttachmentDownloadUrl: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => {
  class AwsAuthenticationRequiredError extends Error {}
  return { requireAwsUser: mocks.requireAwsUser, AwsAuthenticationRequiredError }
})
vi.mock('@/features/learning/learner-assignment-repository', () => ({
  learnerAssignmentRepository: { getAttachmentForViewer: mocks.getAttachmentForViewer },
}))
vi.mock('@/features/learning/assignment-attachments', () => ({
  createAssignmentAttachmentDownloadUrl: mocks.createAssignmentAttachmentDownloadUrl,
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { GET } from './route'

const attachmentId = '66666666-6666-4666-8666-666666666666'
const request = new Request(`https://seanshore.in/api/learn/assignment-attachments/${attachmentId}`)
const params = (id = attachmentId) => ({ params: Promise.resolve({ attachmentId: id }) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
})

describe('GET /api/learn/assignment-attachments/[attachmentId]', () => {
  it('redirects an allowed viewer to a short-lived signed URL and never caches it', async () => {
    mocks.getAttachmentForViewer.mockResolvedValue({ storagePath: 'learning-submissions/x.pdf', fileName: 'report.pdf', contentType: 'application/pdf' })
    mocks.createAssignmentAttachmentDownloadUrl.mockResolvedValue('https://bucket.example/signed?X-Amz-Expires=300')

    const response = await GET(request, params())

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('https://bucket.example/signed?X-Amz-Expires=300')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.getAttachmentForViewer).toHaveBeenCalledWith('viewer-1', attachmentId)
  })

  it('answers 404 to anyone else (another learner or trainer), without revealing the file exists', async () => {
    mocks.getAttachmentForViewer.mockResolvedValue(null)

    const response = await GET(request, params())

    expect(response.status).toBe(404)
    expect(mocks.createAssignmentAttachmentDownloadUrl).not.toHaveBeenCalled()
  })

  it('asks a signed-out visitor to sign in', async () => {
    mocks.requireAwsUser.mockRejectedValue(new AwsAuthenticationRequiredError())

    const response = await GET(request, params())

    expect(response.status).toBe(401)
    expect(mocks.getAttachmentForViewer).not.toHaveBeenCalled()
  })

  it('rejects a malformed id', async () => {
    const response = await GET(request, params('../../etc/passwd'))

    expect(response.status).toBe(404)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
  })
})
