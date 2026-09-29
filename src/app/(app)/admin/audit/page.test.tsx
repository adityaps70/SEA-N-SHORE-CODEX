import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listAuditEvents: vi.fn(),
}))

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
})
