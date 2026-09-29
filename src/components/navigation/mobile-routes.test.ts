import { describe, expect, it, vi } from 'vitest'
import { isPhoneDetailRoute, isPhoneFullScreenRoute } from './mobile-routes'

describe('phone route rules', () => {
  it('keeps the global top bar on the tab and hub pages', () => {
    for (const path of ['/home', '/network', '/jobs', '/notifications', '/learn', '/events', '/community', '/organizations', '/profile']) {
      expect(isPhoneDetailRoute(path), path).toBe(false)
    }
  })

  it('treats posts, jobs, events, courses, chat, settings and other sub-pages as detail routes', () => {
    for (const path of [
      '/posts/p1', '/jobs/j1', '/jobs/saved', '/jobs/applications', '/jobs/alerts', '/hiring', '/hiring/jobs', '/hiring/applicants',
      '/events/e1', '/learn/courses/c1', '/learn/my-learning', '/learn/teach', '/learn/studio', '/learn/studio/courses/new',
      '/messages', '/messages/m1', '/settings', '/settings/billing', '/activities', '/saved', '/search', '/plans', '/creator',
      '/profile/edit', '/organizations/beaufort', '/organizations/beaufort/manage', '/people/prakhar', '/admin', '/admin/users',
    ]) {
      expect(isPhoneDetailRoute(path), path).toBe(true)
    }
  })

  it('hides the tab bar only on full-screen routes', () => {
    for (const path of [
      '/messages/m1', '/learn/courses/c1/learn', '/profile/edit', '/hiring/jobs/new', '/hiring/jobs/j1/edit',
      '/events/create', '/events/new', '/events/e1/edit', '/learn/studio/courses/new', '/learn/studio/courses/c1/edit',
    ]) {
      expect(isPhoneFullScreenRoute(path), path).toBe(true)
    }
    for (const path of ['/home', '/messages', '/jobs/j1', '/events/e1', '/learn/courses/c1', '/settings', '/hiring/jobs']) {
      expect(isPhoneFullScreenRoute(path), path).toBe(false)
    }
  })

  it('makes every full-screen route a detail route too (no top bar without a page bar)', () => {
    for (const path of ['/messages/m1', '/learn/courses/c1/learn', '/profile/edit', '/hiring/jobs/new', '/events/e1/edit', '/learn/studio/courses/new']) {
      expect(isPhoneDetailRoute(path), path).toBe(true)
    }
  })
})

describe('network request count for the Network tab badge', () => {
  it('counts pending requests other members sent to the viewer', async () => {
    const query = vi.fn(async () => [{ count: 3 }])
    const { createNetworkRepository } = await import('@/features/network/repository')
    const repository = createNetworkRepository({ query })

    await expect(repository.countIncomingRequests('viewer-1')).resolves.toBe(3)
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain("status = 'pending'")
    expect(sql).toContain('requested_by <> $1')
    expect(values).toEqual(['viewer-1'])
  })

  it('reads an empty result as zero', async () => {
    const { createNetworkRepository } = await import('@/features/network/repository')
    const repository = createNetworkRepository({ query: async () => [] })
    await expect(repository.countIncomingRequests('viewer-1')).resolves.toBe(0)
  })
})
