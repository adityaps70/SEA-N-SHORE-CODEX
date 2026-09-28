import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { footerLinks } from '@/components/navigation/app-footer'
import { isCognitoProtectedRoute } from '@/lib/auth/cognito-proxy'

/**
 * The payment gateway (Cashfree KYC "Website Details") verifies these pages without
 * signing in. They must exist, stay public and be linked from every footer.
 */
const POLICY_PAGES = [
  { route: '/contact', file: 'src/app/(marketing)/contact/page.tsx' },
  { route: '/terms', file: 'src/app/(marketing)/terms/page.tsx' },
  { route: '/privacy', file: 'src/app/(marketing)/privacy/page.tsx' },
  { route: '/refunds', file: 'src/app/(marketing)/refunds/page.tsx' },
  { route: '/shipping', file: 'src/app/(marketing)/shipping/page.tsx' },
  { route: '/pricing', file: 'src/app/(marketing)/pricing/page.tsx' },
]

describe('payment-gateway policy pages', () => {
  it.each(POLICY_PAGES)('$route exists in the public marketing group and never asks for sign-in', ({ route, file }) => {
    const path = join(process.cwd(), file)
    expect(existsSync(path)).toBe(true)
    const source = readFileSync(path, 'utf8')
    expect(source).not.toMatch(/require(Aws)?User|redirect\(/)
    expect(isCognitoProtectedRoute(route)).toBe(false)
  })

  it.each(POLICY_PAGES)('$route is linked from the footer for signed-out visitors', ({ route }) => {
    expect(footerLinks({ signedIn: false }).map((link) => link.href)).toContain(route)
  })

  it('uses the marketing layout, whose header and footer work without a session', () => {
    const layout = readFileSync(join(process.cwd(), 'src/app/(marketing)/layout.tsx'), 'utf8')
    expect(layout).toContain('<PublicFooter />')
    expect(layout).not.toMatch(/require(Aws)?User/)
  })
})
