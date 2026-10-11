import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/site-url', () => ({ siteUrlFor: (path: string) => new URL(path, 'https://seanshore.in') }))

const routes = {
  legacy: await import('./email/legacy/unsubscribe/route'),
  learning: await import('./email/learning/unsubscribe/route'),
  newsletter: await import('./newsletter/unsubscribe/route'),
  test: await import('./email/legacy/test-unsubscribe/route'),
}

/**
 * Opening a List-Unsubscribe URL in a browser (GET) redirects to the confirmation page on the public site. Behind
 * CloudFront and the ALB the container sees its own address (http://localhost:3000), so the redirect must come from
 * the configured site URL, never from request.url.
 */
describe('one-click unsubscribe GET redirects', () => {
  const internal = 'http://localhost:3000'

  it.each([
    ['legacy reminder', () => routes.legacy.GET(new Request(`${internal}/api/email/legacy/unsubscribe?token=abc`)), 'https://seanshore.in/email/legacy/unsubscribe?token=abc'],
    ['learning', () => routes.learning.GET(new Request(`${internal}/api/email/learning/unsubscribe?token=abc`)), 'https://seanshore.in/email/learning/unsubscribe?token=abc'],
    ['newsletter', () => routes.newsletter.GET(new Request(`${internal}/api/newsletter/unsubscribe?token=abc`)), 'https://seanshore.in/newsletter/unsubscribe?token=abc'],
    ['legacy reminder test', () => routes.test.GET(), 'https://seanshore.in/email/legacy/test-link?link=unsubscribe'],
  ])('%s: redirects to the public site, not the container address', async (_name, open, location) => {
    const response = await open()
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(location)
  })
})
