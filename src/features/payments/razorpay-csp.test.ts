import { describe, expect, it } from 'vitest'
import { pageContentSecurityPolicy } from '@/lib/security/content-security-policy'
import { RAZORPAY_CHECKOUTS_ENABLED } from './provider'

/**
 * Razorpay is a backup gateway, switched on only by hand (RAZORPAY_CHECKOUTS_ENABLED in provider.ts). The page
 * CSP is enforced, so a Razorpay checkout needs these hosts in it: checkout.js from checkout.razorpay.com, its
 * frames and API calls on api.razorpay.com and checkout.razorpay.com, and its form posts (redirect checkout,
 * netbanking) to api.razorpay.com. Turning Razorpay on without them would break every Razorpay payment, so this
 * test fails until the CSP change ships in the same change as the switch.
 */
const RAZORPAY_NEEDS: Record<string, string[]> = {
  'script-src': ['https://checkout.razorpay.com'],
  'frame-src': ['https://api.razorpay.com', 'https://checkout.razorpay.com'],
  'connect-src': ['https://api.razorpay.com'],
  'form-action': ['https://api.razorpay.com'],
}

const policy = pageContentSecurityPolicy('n0nce==', { mediaOrigins: [], realtimeOrigins: [], signInOrigins: [], development: false })

/** Each directive and Razorpay host the page policy does not allow yet. */
function razorpayCspGaps(text: string): string[] {
  const directives = new Map(text.split('; ').map((entry) => {
    const [name, ...sources] = entry.split(' ')
    return [name, sources] as [string, string[]]
  }))
  return Object.entries(RAZORPAY_NEEDS).flatMap(([directive, hosts]) =>
    hosts.filter((host) => !(directives.get(directive) ?? []).includes(host)).map((host) => `${directive} ${host}`))
}

describe('Razorpay checkouts and the enforced Content Security Policy', () => {
  it('fails if Razorpay checkouts are switched on while the CSP does not allow Razorpay', () => {
    if (RAZORPAY_CHECKOUTS_ENABLED) expect(razorpayCspGaps(policy), 'add these to the CSP in the same change').toEqual([])
  })

  it('while Razorpay is off, its form posts stay refused, so turning it on forces the CSP update', () => {
    // 7 Nov 2026: Cashfree only. Razorpay's script, frames and API calls are allowed; its form posts are not.
    if (!RAZORPAY_CHECKOUTS_ENABLED) expect(razorpayCspGaps(policy)).toEqual(['form-action https://api.razorpay.com'])
  })

  it('finds every missing Razorpay host, and none once they are all allowed', () => {
    expect(razorpayCspGaps("default-src 'self'")).toHaveLength(5)
    const allowed = Object.entries(RAZORPAY_NEEDS).map(([directive, hosts]) => [directive, ...hosts].join(' ')).join('; ')
    expect(razorpayCspGaps(allowed)).toEqual([])
  })
})
