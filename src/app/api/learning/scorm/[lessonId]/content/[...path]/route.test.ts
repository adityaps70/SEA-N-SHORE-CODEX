// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  resolveLearnerScormContentKey: vi.fn(),
  getMediaObject: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/scorm-content-repository', () => ({ resolveLearnerScormContentKey: mocks.resolveLearnerScormContentKey }))
vi.mock('@/lib/aws/storage', () => ({ getMediaObject: mocks.getMediaObject }))
vi.mock('@/lib/site-url', () => ({ siteOrigin: () => 'https://seanshore.in' }))

const learner = '0b3c6f6e-1c2d-4e5f-8a9b-0c1d2e3f4a5b'
const lesson = '7d1f2a3b-4c5d-4e6f-9a8b-1c2d3e4f5a6b'

async function get(path: string[]) {
  const { GET } = await import('./route')
  return GET(new Request('https://seanshore.in/api/learning/scorm/x'), { params: Promise.resolve({ lessonId: lesson, path }) })
}

describe('SCORM content route (Round 14, 2.3)', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('REALTIME_TICKET_SECRET', 'x'.repeat(48))
    mocks.resolveLearnerScormContentKey.mockResolvedValue('learning/scorm/pkg/index.html')
    mocks.getMediaObject.mockResolvedValue({ body: new TextEncoder().encode('<html><head><title>t</title></head></html>'), contentType: 'text/html; charset=utf-8', contentLength: 41 })
  })

  it('serves files through a signed segment without the session cookie, sandboxed and bridged', async () => {
    const { createScormContentToken } = await import('@/features/learning/scorm-content-link')
    const token = createScormContentToken(learner, lesson)!
    const response = await get([token, 'index.html'])
    expect(response.status).toBe(200)
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()
    expect(mocks.resolveLearnerScormContentKey).toHaveBeenCalledWith(learner, lesson, 'index.html')
    expect(response.headers.get('content-security-policy')).toBe("sandbox allow-scripts allow-forms allow-popups allow-downloads; frame-ancestors 'self'")
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    const html = await response.text()
    expect(html).toMatch(/^<html><head><script>/)
    expect(html).toContain('target="https://seanshore.in"')
    expect(Number(response.headers.get('content-length'))).toBe(new TextEncoder().encode(html).byteLength)
  })

  it('refuses a token for another lesson or a tampered one', async () => {
    const { createScormContentToken } = await import('@/features/learning/scorm-content-link')
    const other = createScormContentToken(learner, '00000000-0000-4000-8000-000000000000')!
    expect((await get([other, 'index.html'])).status).toBe(404)
    expect(mocks.resolveLearnerScormContentKey).not.toHaveBeenCalled()
  })

  it('still serves signed-in members without a token, and leaves non-HTML files untouched', async () => {
    mocks.requireAwsUser.mockResolvedValue({ id: learner })
    mocks.getMediaObject.mockResolvedValueOnce({ body: new TextEncoder().encode('var a=1'), contentType: 'text/javascript; charset=utf-8', contentLength: 7 })
    const response = await get(['js', 'app.js'])
    expect(response.status).toBe(200)
    expect(mocks.resolveLearnerScormContentKey).toHaveBeenCalledWith(learner, lesson, 'js/app.js')
    expect(await response.text()).toBe('var a=1')
    expect(response.headers.get('content-security-policy')).toContain('sandbox allow-scripts')
  })
})
