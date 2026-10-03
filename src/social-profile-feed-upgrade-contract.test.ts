import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('social profile and feed upgrade contract', () => {
  it('shows a member post section on the public profile', () => {
    const page = source('src/app/(public)/people/[slug]/page.tsx')
    expect(page).toContain('getPublicPostsByAuthor')
    expect(page).toContain('<PostCard')
    expect(page).toContain('Posts')
  })

  it('gives My Activities the home-style profile rail and discovery rail', () => {
    const page = source('src/app/(app)/activities/page.tsx')
    expect(page).toContain('FeedProfileCard')
    expect(page).toContain('Apply to jobs')
    expect(page).toContain('PeopleYouMayKnow')
    expect(page).toContain('getPublishedJobs')
  })

  it('uses route-aware active navigation on desktop and mobile', () => {
    const desktop = source('src/components/navigation/app-header.tsx')
    const mobile = source('src/components/navigation/mobile-nav.tsx')
    expect(desktop).toContain('ActiveNavLink')
    expect(mobile).toContain('ActiveNavLink')
  })

  it('autoplays feed video muted while visible', () => {
    const media = source('src/features/feed/components/post-media.tsx')
    expect(media).toContain("'use client'")
    expect(media).toContain('IntersectionObserver')
    expect(media).toContain('muted')
    expect(media).toContain('playsInline')
    expect(media).toContain('.play()')
    expect(media).toContain('.pause()')
  })
})
