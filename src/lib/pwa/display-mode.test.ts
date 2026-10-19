import { describe, expect, it } from 'vitest'
import { summarizeUserAgent } from '@/features/account-security/user-agent'
import { sessionRequestContext } from '@/features/account-security/request-context'
import { displayModeCookieLine, runningIosHomeScreenApp, runningStandalone, standaloneFromCookieHeader } from './display-mode'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'

const view = (input: { standalone?: boolean; displayMode?: string; userAgent?: string }) => ({
  navigator: { standalone: input.standalone, userAgent: input.userAgent ?? IPHONE, maxTouchPoints: 5 },
  matchMedia: (query: string) => ({ matches: query === `(display-mode: ${input.displayMode ?? 'browser'})` }),
})

describe('Home Screen app marker (Round I, I3)', () => {
  it('tells the Home Screen app from a Safari tab', () => {
    expect(runningStandalone(view({ standalone: true }))).toBe(true)
    expect(runningStandalone(view({ displayMode: 'standalone' }))).toBe(true)
    expect(runningStandalone(view({}))).toBe(false)
    expect(runningIosHomeScreenApp(view({ standalone: true }))).toBe(true)
    expect(runningIosHomeScreenApp(view({ displayMode: 'standalone', userAgent: ANDROID }))).toBe(false)
    expect(runningIosHomeScreenApp(view({ userAgent: IPHONE }))).toBe(false)
  })

  it('writes a site-wide, SameSite=Lax marker for a year, and clears it in a browser tab', () => {
    expect(displayModeCookieLine(true, true)).toBe('sns_display_mode=standalone; Max-Age=31536000; Path=/; SameSite=Lax; Secure')
    expect(displayModeCookieLine(false, true)).toBe('sns_display_mode=; Max-Age=0; Path=/; SameSite=Lax; Secure')
    expect(standaloneFromCookieHeader('a=b; sns_display_mode=standalone')).toBe(true)
    expect(standaloneFromCookieHeader('sns_display_mode=browser')).toBe(false)
    expect(standaloneFromCookieHeader(null)).toBe(false)
  })

  it('lists the Home Screen app as its own device in Active sessions', () => {
    expect(summarizeUserAgent(IPHONE, { standalone: true })).toMatchObject({ summary: 'Home Screen app on iPhone', kind: 'phone' })
    expect(summarizeUserAgent(IPHONE)).toMatchObject({ summary: 'Safari on iPhone', kind: 'phone' })
    expect(summarizeUserAgent(ANDROID, { standalone: true }).summary).toBe('Installed app on Android phone')
    const headers = new Headers({ 'user-agent': IPHONE, cookie: 'sns_display_mode=standalone' })
    expect(sessionRequestContext(headers).userAgentSummary).toBe('Home Screen app on iPhone')
  })
})
