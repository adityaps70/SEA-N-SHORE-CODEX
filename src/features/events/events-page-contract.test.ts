import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(
  fileURLToPath(new URL('../../app/(app)/events/page.tsx', import.meta.url)),
  'utf8',
)

describe('events discovery page contract', () => {
  it('uses a LinkedIn-familiar maritime discovery structure without pretending unsupported event actions are live', () => {
    expect(pageSource).toContain('Maritime events')
    expect(pageSource).toContain('Discover')
    expect(pageSource).toContain('My Events')
    expect(pageSource).toContain('Hosting')
    expect(pageSource).toContain('Upcoming events')
    expect(pageSource).toContain('Explore event formats')
    expect(pageSource).toContain('Host on Sea N Shore')
    expect(pageSource).toContain('Event archive')
    expect(pageSource).toContain('Coming soon')
    expect(pageSource).not.toContain('ProductSurface')
    expect(pageSource).not.toContain('RSVP now')
    expect(pageSource).not.toContain('Register now')
  })
})
