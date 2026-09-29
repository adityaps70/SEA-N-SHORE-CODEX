import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getApplicationCvAccess: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/jobs/hiring-repository', () => ({
  hiringRepository: { getApplicationCvAccess: mocks.getApplicationCvAccess },
}))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject: mocks.getMediaObject }))

import { GET } from './route'

const applicationId = '33333333-3333-4333-8333-333333333333'
const storagePath = 'job-applications/candidate-1/job-1/11111111-1111-4111-8111-111111111111.pdf'

function call(id = applicationId, search = '') {
  return GET(
    new Request(`https://seanshore.test/api/jobs/applications/${id}/cv${search}`),
    { params: Promise.resolve({ applicationId: id }) },
  )
}

describe('GET /api/jobs/applications/[applicationId]/cv', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: 'recruiter-1' })
    mocks.getApplicationCvAccess.mockResolvedValue({
      viewer: 'hiring',
      cv: { storagePath, fileName: 'Capt Rahül CV.pdf', mimeType: 'application/pdf', sizeBytes: 5 },
    })
    mocks.getMediaObject.mockResolvedValue({ body: new TextEncoder().encode('%PDF-'), contentType: 'application/pdf', contentLength: 5 })
  })

  it('requires a signed-in member', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(401)
    expect(mocks.getApplicationCvAccess).not.toHaveBeenCalled()
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
  })

  it('returns 404 for an invalid id without touching the database', async () => {
    const response = await call('not-a-uuid')
    expect(response.status).toBe(404)
    expect(mocks.getApplicationCvAccess).not.toHaveBeenCalled()
  })

  it('denies anyone who is not the applicant or on the job’s hiring team, without revealing the file', async () => {
    mocks.getApplicationCvAccess.mockResolvedValue(null)
    const response = await call()
    expect(response.status).toBe(404)
    expect(mocks.getApplicationCvAccess).toHaveBeenCalledWith('recruiter-1', applicationId)
    expect(mocks.getMediaObject).not.toHaveBeenCalled()
  })

  it('streams the PDF privately to an authorized reviewer', async () => {
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('application/pdf')
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-disposition')).toMatch(/^inline; filename="Capt Rah_l CV\.pdf"; filename\*=UTF-8''Capt%20Rah%C3%BCl%20CV\.pdf$/)
    expect(mocks.getMediaObject).toHaveBeenCalledWith({ key: storagePath, maxBytes: 10 * 1024 * 1024 })
    expect(new TextDecoder().decode(new Uint8Array(await response.arrayBuffer()))).toBe('%PDF-')
  })

  it('offers a download when asked', async () => {
    const response = await call(applicationId, '?download=1')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment;/)
  })

  it('sends the reviewer back with a clear message when the application has no CV', async () => {
    mocks.getApplicationCvAccess.mockResolvedValue({ viewer: 'hiring', cv: null })
    const response = await call()
    expect(response.status).toBe(303)
    // Redirects are built on NEXT_PUBLIC_SITE_URL, never on the request host the container sees.
    expect(response.headers.get('location')).toBe(`http://localhost:3000/hiring/applicants/${applicationId}?cv=missing`)
  })

  it('sends the reviewer back when the stored file is gone or storage fails', async () => {
    mocks.getMediaObject.mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'NoSuchKey' }))
    const missing = await call()
    expect(missing.headers.get('location')).toContain('?cv=missing')

    mocks.getMediaObject.mockRejectedValueOnce(new Error('timeout'))
    const unavailable = await call()
    expect(unavailable.status).toBe(303)
    expect(unavailable.headers.get('location')).toContain('?cv=unavailable')
  })

  it('lets applicants open their own CV and returns them to their applications on failure', async () => {
    mocks.getApplicationCvAccess.mockResolvedValue({ viewer: 'applicant', cv: null })
    const response = await call()
    expect(response.headers.get('location')).toBe('http://localhost:3000/jobs/applications?cv=missing')
  })
})
