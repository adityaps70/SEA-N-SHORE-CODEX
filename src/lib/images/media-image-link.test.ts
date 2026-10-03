// @vitest-environment node
import { describe, expect, it } from 'vitest'
import {
  MEDIA_IMAGE_LINK_WINDOW_SECONDS,
  mediaImageWindow,
  createMediaImageLink,
  isMediaImageKey,
  isMediaImageLink,
  mediaImageLinkKey,
  verifyMediaImageLink,
} from './media-image-link'

const environment = { REALTIME_TICKET_SECRET: 'r'.repeat(48) }
const WINDOW_MS = MEDIA_IMAGE_LINK_WINDOW_SECONDS * 1000
const AVATAR = 'profiles/11111111-1111-4111-8111-111111111111/avatar-22222222-2222-4222-8222-222222222222.webp'
// A minute after this key's window starts, so +1 hour and +1 day stay inside the window.
const BASE = Date.UTC(2026, 9, 3)
let NOW = BASE
while (mediaImageWindow(AVATAR, NOW - 60_000) === mediaImageWindow(AVATAR, NOW)) NOW += 60_000

function parse(link: string) {
  const url = new URL(link, 'https://seanshore.in')
  const key = url.pathname.replace('/api/media/image/', '').split('/').map(decodeURIComponent).join('/')
  return { key, w: url.searchParams.get('w'), s: url.searchParams.get('s') }
}

describe('stable media image links', () => {
  it('gives the same link all window long, so the optimizer cache survives clock hours', () => {
    const first = createMediaImageLink(AVATAR, { now: NOW, environment })
    const hourLater = createMediaImageLink(AVATAR, { now: NOW + 60 * 60 * 1000, environment })
    const dayLater = createMediaImageLink(AVATAR, { now: NOW + 24 * 60 * 60 * 1000, environment })
    expect(first).toMatch(/^\/api\/media\/image\/profiles\/[^?]+\?w=\d+&s=[A-Za-z0-9_-]{32}$/)
    expect(hourLater).toBe(first)
    expect(dayLater).toBe(first)
    expect(isMediaImageLink(first ?? '')).toBe(true)
  })

  it('spreads window rollovers across keys instead of one monthly storm', () => {
    const keys = Array.from({ length: 200 }, (_, index) => `profiles/p${index}/avatar-${index}.webp`)
    const rolledWithinADay = keys.filter((key) => mediaImageWindow(key, BASE) !== mediaImageWindow(key, BASE + 24 * 60 * 60 * 1000))
    // About 1 in 30 keys roll over on any given day.
    expect(rolledWithinADay.length).toBeGreaterThan(0)
    expect(rolledWithinADay.length).toBeLessThan(30)
  })

  it('verifies its own links in the current and the previous window only', () => {
    const link = createMediaImageLink(AVATAR, { now: NOW, environment }) ?? ''
    const { key, w, s } = parse(link)
    expect(key).toBe(AVATAR)
    expect(verifyMediaImageLink(key, w, s, { now: NOW, environment })).toEqual({ ok: true })
    expect(verifyMediaImageLink(key, w, s, { now: NOW + WINDOW_MS, environment })).toEqual({ ok: true })
    expect(verifyMediaImageLink(key, w, s, { now: NOW + 2 * WINDOW_MS, environment })).toEqual({ ok: false, reason: 'expired' })
  })

  it('rejects forged, altered and other-key signatures', () => {
    const { key, w, s } = parse(createMediaImageLink(AVATAR, { now: NOW, environment }) ?? '')
    const other = AVATAR.replace('avatar-', 'cover-')
    expect(verifyMediaImageLink(other, w, s, { now: NOW, environment })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyMediaImageLink(key, w, (s ?? '').replace(/^./, (c) => (c === 'A' ? 'B' : 'A')), { now: NOW, environment }))
      .toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyMediaImageLink(key, w, null, { now: NOW, environment })).toEqual({ ok: false, reason: 'bad_signature' })
    expect(verifyMediaImageLink(key, 'abc', s, { now: NOW, environment })).toEqual({ ok: false, reason: 'bad_window' })
    expect(verifyMediaImageLink(key, w, s, { now: NOW, environment: { REALTIME_TICKET_SECRET: 'x'.repeat(48) } }))
      .toEqual({ ok: false, reason: 'bad_signature' })
  })

  it('serves only public-facing photo keys, never documents, attachments or post media', () => {
    for (const key of [
      AVATAR,
      'profiles/abc/cover-1.jpg',
      'profiles/abc/avatar.webp',
      'organizations/abc/logo-1.png',
      'organizations/abc/cover-1.jpeg',
      'communities/abc/icon-1.webp',
      'communities/abc/cover-1.jpg',
      'events/abc/banners/1.png',
    ]) {
      expect(isMediaImageKey(key), key).toBe(true)
    }
    for (const key of [
      'profiles/abc/passport-1.jpg',
      'profiles/abc/avatar-1.pdf',
      'profiles/abc/avatar-1.svg',
      'messages/abc/conv/1.jpg',
      'learning/abc/course/asset/1.png',
      'posts/abc/1.jpg',
      'profiles/../secret/avatar.jpg',
      'profiles/abc/../avatar.jpg',
      '/profiles/abc/avatar.jpg',
      'profiles/abc/avatar.jpg?x=1',
      'media/private-migrations/beaufortmarine.sql',
    ]) {
      expect(isMediaImageKey(key), key).toBe(false)
      expect(createMediaImageLink(key, { now: NOW, environment }), key).toBeNull()
    }
  })

  it('falls back (null) without a configured secret and derives a key separate from the source secret', () => {
    expect(createMediaImageLink(AVATAR, { now: NOW, environment: {} })).toBeNull()
    expect(createMediaImageLink(AVATAR, { now: NOW, environment: { REALTIME_TICKET_SECRET: 'short' } })).toBeNull()
    expect(verifyMediaImageLink(AVATAR, '1', 'x', { now: NOW, environment: {} })).toEqual({ ok: false, reason: 'not_configured' })
    const key = mediaImageLinkKey(environment)
    expect(key?.length).toBe(32)
    expect(key?.toString('utf8')).not.toContain('rrrr')
  })
})
