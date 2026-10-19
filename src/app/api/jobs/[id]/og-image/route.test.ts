// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ renderOpenGraph: vi.fn() }))
vi.mock('@/features/jobs/share/share-runtime', () => ({ jobShareService: { renderOpenGraph: mocks.renderOpenGraph } }))

import { GET } from './route'

const JOB = '7d3f1c2a-1111-4222-8333-444455556666'
const call = () => GET(new Request(`https://seanshore.in/api/jobs/${JOB}/og-image`), { params: Promise.resolve({ id: JOB }) })

describe('GET /api/jobs/[id]/og-image (Round I, I1)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('serves the public Portrait image of an open job to anyone, without signing in', async () => {
    mocks.renderOpenGraph.mockResolvedValue({ png: Buffer.from([0x89, 0x50, 0x4e, 0x47]) })
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(response.headers.get('cache-control')).toContain('public')
    expect(mocks.renderOpenGraph).toHaveBeenCalledWith(JOB)
  })

  it('has no image for a job that is not public and open (draft, closed, expired, deleted)', async () => {
    mocks.renderOpenGraph.mockResolvedValue(null)
    expect((await call()).status).toBe(404)
  })
})
