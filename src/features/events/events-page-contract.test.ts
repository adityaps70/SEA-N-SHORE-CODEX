import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const pageSource = readFileSync(resolve(process.cwd(), 'src/app/(app)/events/page.tsx'), 'utf8')

describe('working events discovery page contract', () => {
  it('exposes real event navigation and contains no coming-soon placeholders', () => {
    expect(pageSource).toContain('Maritime events')
    expect(pageSource).toContain('Discover')
    expect(pageSource).toContain('My Events')
    expect(pageSource).toContain('Hosting')
    expect(pageSource).toContain('Upcoming events')
    expect(pageSource).toContain('Event archive')
    expect(pageSource).toContain('href="/events/my"')
    expect(pageSource).toContain('href="/events/hosting"')
    expect(pageSource).toContain('href="/events/new"')
    expect(pageSource.toLowerCase()).not.toContain('coming soon')
    expect(pageSource).not.toContain('ProductSurface')
  })
})
