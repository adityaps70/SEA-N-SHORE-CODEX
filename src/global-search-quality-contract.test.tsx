import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  expect(existsSync(path), `${path} should exist`).toBe(true)
  return readFileSync(path, 'utf8')
}

describe('global search quality contract', () => {
  it('routes the app header search to a dedicated global search while preserving q', () => {
    const header = source('src/components/navigation/app-header.tsx')

    expect(header).toContain('action="/search"')
    expect(header).toContain('name="q"')
    expect(header).toContain('Search Sea N Shore')
  })

  it('searches People, Organizations, Jobs, Courses and Events from one query', () => {
    const page = source('src/app/(app)/search/page.tsx')

    expect(page).toContain('getNetworkHub')
    expect(page).toContain('getJobsDiscovery')
    expect(page).toContain('marketplaceRepository.listPublishedCourses')
    expect(page).toContain('calendarEventRepository.listDiscoverEvents')
    expect(page).toContain('organizationRepository.searchCompanies')
    expect(page).toContain('Promise.all')
    expect(page).toContain('People')
    expect(page).toContain('Organizations')
    expect(page).toContain('Jobs')
    expect(page).toContain('Courses')
    expect(page).toContain('Events')
  })

  it('keeps the same query when users continue into each vertical', () => {
    const page = source('src/app/(app)/search/page.tsx')

    expect(page).toContain("params.set('q', query)")
    expect(page).toContain("params.set('search', query)")
    expect(page).toContain("'/network'")
    expect(page).toContain("'/jobs'")
    expect(page).toContain("'/learn'")
    expect(page).toContain("'/events'")
    expect(page).toContain("'/organizations'")
  })
})
