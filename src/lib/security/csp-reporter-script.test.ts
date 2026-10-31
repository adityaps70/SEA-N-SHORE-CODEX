// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CSP_REPORT_PATH } from './content-security-policy'
import { CSP_REPORTER_BATCH_SIZE, CSP_REPORTER_DELAY_MS, CSP_REPORTER_MAX_UNIQUE, CSP_REPORTER_SCRIPT, nonceFromContentSecurityPolicy } from './csp-reporter-script'

const beacons: Array<{ url: string; body: { violations: Array<{ directive: string; blocked: string; source: string; section: string }> } }> = []
let removeListeners: () => void = () => undefined

function violate(effectiveDirective: string, blockedURI: string, sourceFile = '') {
  document.dispatchEvent(Object.assign(new Event('securitypolicyviolation'), { effectiveDirective, blockedURI, sourceFile }))
}

function sent() {
  return beacons.flatMap((beacon) => beacon.body.violations)
}

beforeEach(async () => {
  vi.useFakeTimers()
  beacons.length = 0
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator), {
    sendBeacon: vi.fn((url: string, blob: Blob) => {
      // jsdom's Blob has no text(); FileReader reads it.
      const reader = new FileReader()
      reader.onload = () => beacons.push({ url, body: JSON.parse(String(reader.result)) })
      reader.readAsText(blob)
      return true
    }),
  }))
  // Run the inline script as the page would, keeping its listeners so each test can remove them.
  const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
  for (const target of [document, window]) {
    const original = target.addEventListener.bind(target)
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
      added.push([target, type, listener])
      original(type, listener)
    })
  }
  new Function(CSP_REPORTER_SCRIPT)()
  removeListeners = () => { for (const [target, type, listener] of added) target.removeEventListener(type, listener) }
})

afterEach(() => {
  removeListeners()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function flushBeacons() {
  vi.advanceTimersByTime(CSP_REPORTER_DELAY_MS)
  await vi.waitFor(() => expect(beacons.length).toBeGreaterThan(0))
}

describe('CSP page reporter (Round P3)', () => {
  it('reports each unique violation once per page load, in one batch, to the report endpoint', async () => {
    for (let index = 0; index < 5; index += 1) violate('style-src-attr', 'inline')
    violate('img-src', 'https://cdn.example.com/a.png?token=secret')
    violate('img-src', 'https://cdn.example.com/b.png')
    violate('script-src-elem', 'inline')
    expect(beacons).toEqual([])

    await flushBeacons()

    expect(beacons).toHaveLength(1)
    expect(beacons[0]?.url).toBe(CSP_REPORT_PATH)
    expect(sent()).toEqual([
      { directive: 'style-src-attr', blocked: 'inline', source: 'none', section: 'home' },
      { directive: 'img-src', blocked: 'https://cdn.example.com', source: 'none', section: 'home' },
      { directive: 'script-src-elem', blocked: 'inline', source: 'none', section: 'home' },
    ])
    // Only the origin leaves the browser: no paths or query strings.
    expect(JSON.stringify(beacons)).not.toMatch(/token|secret|a\.png/)

    violate('style-src-attr', 'inline')
    vi.advanceTimersByTime(CSP_REPORTER_DELAY_MS * 2)
    await Promise.resolve()
    expect(beacons).toHaveLength(1)
  })

  it('keeps every kind of violation: a new kind later in the page is still sent', async () => {
    violate('img-src', 'data')
    await flushBeacons()
    violate('connect-src', 'wss://other.example:8443/socket?ticket=t')
    vi.advanceTimersByTime(CSP_REPORTER_DELAY_MS)
    await vi.waitFor(() => expect(beacons).toHaveLength(2))
    expect(sent()).toEqual([{ directive: 'img-src', blocked: 'data', source: 'none', section: 'home' }, { directive: 'connect-src', blocked: 'wss://other.example:8443', source: 'none', section: 'home' }])
  })

  it('sends at once when the page is hidden, and splits large pages into batches', async () => {
    for (let index = 0; index < CSP_REPORTER_BATCH_SIZE + 3; index += 1) violate('img-src', `https://host-${index}.example.com/x.png`)
    await vi.waitFor(() => expect(beacons).toHaveLength(1))
    expect(beacons[0]?.body.violations).toHaveLength(CSP_REPORTER_BATCH_SIZE)

    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(beacons).toHaveLength(2))
    expect(beacons[1]?.body.violations).toHaveLength(3)
  })

  it('stops at a bounded number of unique violations per page load', async () => {
    for (let index = 0; index < CSP_REPORTER_MAX_UNIQUE + 50; index += 1) violate('img-src', `https://host-${index}.example.com/`)
    window.dispatchEvent(new Event('pagehide'))
    await vi.waitFor(() => expect(sent()).toHaveLength(CSP_REPORTER_MAX_UNIQUE))
  })

  // Round P3 (enforcement prep): which script caused each violation, by origin only, and the site section.
  it('says which script caused a violation by origin only: our site, an extension, another origin or none', async () => {
    violate('script-src', 'eval', `${location.origin}/_next/static/chunks/app.js?v=1`)
    violate('script-src', 'eval', 'chrome-extension://abcdefghijklmnop/content.js')
    violate('script-src', 'eval', 'moz-extension://1234-5678/inject.js')
    violate('script-src', 'wasm-eval', 'https://sdk.cashfree.com/js/v3/cashfree.js?session=secret')
    violate('script-src', 'eval', '')
    await flushBeacons()
    expect(sent()).toEqual([
      { directive: 'script-src', blocked: 'eval', source: 'self', section: 'home' },
      { directive: 'script-src', blocked: 'eval', source: 'extension', section: 'home' },
      { directive: 'script-src', blocked: 'wasm-eval', source: 'https://sdk.cashfree.com', section: 'home' },
      { directive: 'script-src', blocked: 'eval', source: 'none', section: 'home' },
    ])
    expect(JSON.stringify(beacons)).not.toMatch(/chunks|content\.js|abcdefghijklmnop|session|secret/)
  })

  it('sends only the first segment of the page path as the section: no deeper path, IDs or query', async () => {
    removeListeners()
    const path = location.pathname + location.search
    history.pushState({}, '', '/learn/courses/sire-2-readiness/learn?lesson=11111111-1111-4111-8111-111111111111')
    try {
      new Function(CSP_REPORTER_SCRIPT)()
      violate('frame-src', '')
      await flushBeacons()
      expect(sent()).toEqual([{ directive: 'frame-src', blocked: 'none', source: 'none', section: 'learn' }])
      expect(JSON.stringify(beacons)).not.toMatch(/courses|sire|lesson|1111/)
    } finally {
      history.pushState({}, '', path)
    }
  })

  it('reads the nonce out of the page policy', () => {
    expect(nonceFromContentSecurityPolicy("default-src 'self'; script-src 'self' 'nonce-AbC123+/xyZ==' 'strict-dynamic'")).toBe('AbC123+/xyZ==')
    expect(nonceFromContentSecurityPolicy("default-src 'none'")).toBeNull()
    expect(nonceFromContentSecurityPolicy(null)).toBeNull()
  })
})
