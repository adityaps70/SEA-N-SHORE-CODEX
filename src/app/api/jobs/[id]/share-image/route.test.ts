// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  renderForViewer: vi.fn(),
  layoutForViewer: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => {
  class AwsAuthenticationRequiredError extends Error {}
  return { AwsAuthenticationRequiredError, requireAwsUser: mocks.requireAwsUser }
})
vi.mock('@/features/jobs/share/share-runtime', () => ({
  jobShareService: { renderForViewer: mocks.renderForViewer, layoutForViewer: mocks.layoutForViewer },
}))

import { AwsAuthenticationRequiredError } from '@/features/auth/aws-queries'
import { JobShareError } from '@/features/jobs/share/share-service'
import { GET } from './route'

const JOB = '7d3f1c2a-1111-4222-8333-444455556666'
const call = (search = '', headers: Record<string, string> = {}) =>
  GET(new Request(`https://seanshore.in/api/jobs/${JOB}/share-image${search}`, { headers }), { params: Promise.resolve({ id: JOB }) })

describe('GET /api/jobs/[id]/share-image (Round I, I1)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
    mocks.renderForViewer.mockResolvedValue({ png: Buffer.from([0x89, 0x50, 0x4e, 0x47]), cacheKey: 'job|key' })
  })

  it('asks a signed-out visitor to sign in', async () => {
    mocks.requireAwsUser.mockRejectedValue(new AwsAuthenticationRequiredError())
    const response = await call()
    expect(response.status).toBe(401)
    expect(mocks.renderForViewer).not.toHaveBeenCalled()
  })

  it('refuses anyone who may not share the job, and closed jobs', async () => {
    mocks.renderForViewer.mockRejectedValueOnce(new JobShareError('job_share_forbidden'))
    expect((await call()).status).toBe(403)
    mocks.renderForViewer.mockRejectedValueOnce(new JobShareError('job_share_closed'))
    expect((await call()).status).toBe(409)
  })

  it('returns a private PNG with an ETag, a 304 for the same image, and a file for ?download=1', async () => {
    const response = await call('?size=story&look=teal')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toBe('private, max-age=300')
    const etag = response.headers.get('etag')!
    expect(mocks.renderForViewer.mock.calls[0]![2].get('size')).toBe('story')
    expect((await call('', { 'if-none-match': etag })).status).toBe(304)
    expect((await call('?download=1&size=square')).headers.get('content-disposition')).toBe('attachment; filename="sea-n-shore-job-square.png"')
  })

  it('answers ?format=json with the fits check', async () => {
    mocks.layoutForViewer.mockResolvedValue({ fits: true, title: { size: 72, lines: ['A'], truncated: false } })
    const response = await call('?format=json')
    await expect(response.json()).resolves.toEqual({ fits: true, titleSize: 72, titleLines: 1, truncated: false })
    expect(mocks.renderForViewer).not.toHaveBeenCalled()
  })

  it('treats a malformed job id as not found', async () => {
    const response = await GET(new Request('https://seanshore.in/api/jobs/nope/share-image'), { params: Promise.resolve({ id: 'nope' }) })
    expect(response.status).toBe(404)
  })
})
