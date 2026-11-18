import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listAuditEvents: vi.fn(),
}))

// Round GP (Part C): pages check access through requireAdminAccess; here it follows the existing mock above.
vi.mock('@/features/admin/admin-access', async () => {
  const auth = await import('@/features/auth/aws-queries')
  // Like the real gate: anyone who is not an administrator gets the not-found page.
  return {
    requireAdminAccess: async () => {
      try {
        return { kind: 'platform', user: await auth.requireAwsUser() }
      } catch (error) {
        if (error instanceof Error && error.message === 'admin_forbidden') (await import('next/navigation')).notFound()
        throw error
      }
    },
  }
})
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/repository', () => ({ adminRepository: { listAuditEvents: mocks.listAuditEvents } }))

import AdminAuditPage from './page'

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1' })
  mocks.listAuditEvents.mockResolvedValue([])
})

describe('/admin/audit', () => {
  it('offers a Groups filter (round 9C) that loads community group events only', async () => {
    render(await AdminAuditPage({ searchParams: Promise.resolve({ type: 'group' }) }))
    const filters = screen.getByRole('navigation', { name: 'Audit filters' })
    expect(within(filters).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['All activity', '/admin/audit?type=all'],
      ['Posts', '/admin/audit?type=post'],
      ['Comments', '/admin/audit?type=comment'],
      ['Jobs', '/admin/audit?type=job'],
      ['Events', '/admin/audit?type=event'],
      ['Groups', '/admin/audit?type=group'],
      ['Organizations', '/admin/audit?type=organization_application'],
    ])
    expect(within(filters).getByRole('link', { name: 'Groups' })).toHaveAttribute('aria-current', 'true')
    expect(mocks.listAuditEvents).toHaveBeenCalledWith('admin-1', { targetType: 'group', limit: 100 })
  })

  it('falls back to all activity for an unknown filter and renders group events with a link to the Communities admin page', async () => {
    mocks.listAuditEvents.mockResolvedValue([{
      id: 'a1',
      actor: { id: 'admin-1', fullName: 'Admin User', slug: 'admin-user' },
      action: 'community.ownership_transferred',
      targetType: 'group',
      targetId: 'g1',
      metadata: { owner_id: 'p2' },
      createdAt: '2026-09-29T08:00:00.000Z',
    }])
    render(await AdminAuditPage({ searchParams: Promise.resolve({ type: 'nonsense' }) }))
    expect(mocks.listAuditEvents).toHaveBeenCalledWith('admin-1', { targetType: 'all', limit: 100 })
    expect(screen.getAllByText('Group').length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'Open group' })[0]).toHaveAttribute('href', '/admin/communities?group=g1')
  })
  it('filters by one administrator, a country and country admin decisions (Round GP, Part C), keeping them across type links', async () => {
    const actor = '11111111-1111-4111-8111-111111111111'
    render(await AdminAuditPage({ searchParams: Promise.resolve({ type: 'organization_application', actor, country: 'ph', role: 'country_admin' }) }))
    expect(mocks.listAuditEvents).toHaveBeenCalledWith('admin-1', {
      targetType: 'organization_application', limit: 100, actorId: actor, country: 'PH', countryAdminsOnly: true,
    })
    const filters = screen.getByRole('navigation', { name: 'Audit filters' })
    expect(within(filters).getByRole('link', { name: 'Posts' })).toHaveAttribute('href', `/admin/audit?type=post&actor=${actor}&country=PH&role=country_admin`)
    expect(screen.getByRole('link', { name: 'Clear' })).toHaveAttribute('href', '/admin/audit?type=organization_application')
  })

  it('ignores an actor that is not an id and a country that is not on the list', async () => {
    render(await AdminAuditPage({ searchParams: Promise.resolve({ actor: "x' or 1=1", country: 'ZZ' }) }))
    expect(mocks.listAuditEvents).toHaveBeenCalledWith('admin-1', { targetType: 'all', limit: 100 })
  })
})
