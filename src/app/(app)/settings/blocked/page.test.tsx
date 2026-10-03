import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listBlockedByViewer: vi.fn(),
  unblockProfile: vi.fn(),
  createMediaReadUrl: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/network/blocked-members-repository', () => ({
  blockedMembersRepository: { listBlockedByViewer: mocks.listBlockedByViewer },
}))
vi.mock('@/features/network/actions', () => ({ unblockProfile: mocks.unblockProfile }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))

import BlockedMembersPage from './page'

const rinki = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Rinki Mukharjee',
  slug: 'rinki-mukharjee',
  headline: 'Shore professional',
  avatarPath: 'profiles/rinki/avatar.jpg',
  blockedAt: '2026-09-02T10:00:00.000Z',
}
const former = {
  id: '22222222-2222-4222-8222-222222222222',
  fullName: 'Sea N Shore member',
  slug: null,
  headline: null,
  avatarPath: null,
  blockedAt: '2026-08-12T10:00:00.000Z',
}

afterEach(() => cleanup())

describe('/settings/blocked', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
    mocks.listBlockedByViewer.mockResolvedValue([rinki, former])
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example.com/rinki.jpg')
  })

  it('lists the members the viewer blocked with a page bar back to Settings', async () => {
    render(await BlockedMembersPage())

    expect(mocks.listBlockedByViewer).toHaveBeenCalledWith('viewer-1')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
    expect(screen.getByRole('heading', { name: 'Blocked members' })).toBeInTheDocument()

    const list = screen.getByRole('list', { name: 'Blocked members' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(within(rows[0]).getByText('Rinki Mukharjee')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Shore professional')).toBeInTheDocument()
    expect(within(rows[0]).getByText('Blocked 2 Sept 2026')).toBeInTheDocument()
    expect(rows[0].querySelector('img')).toHaveAttribute('src', 'https://signed.example.com/rinki.jpg')
    expect(within(rows[1]).getByRole('button', { name: 'Unblock Sea N Shore member' })).toBeEnabled()
  })

  it('unblocks a member with the network unblock action and confirms it in place', async () => {
    mocks.unblockProfile.mockResolvedValueOnce({ ok: true })
    render(await BlockedMembersPage())

    fireEvent.click(screen.getByRole('button', { name: 'Unblock Rinki Mukharjee' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Unblocked'))
    expect(mocks.unblockProfile).toHaveBeenCalledWith(rinki.id)
    expect(screen.queryByRole('button', { name: 'Unblock Rinki Mukharjee' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rinki Mukharjee' })).toHaveAttribute('href', '/people/rinki-mukharjee')
    expect(screen.getByRole('button', { name: 'Unblock Sea N Shore member' })).toBeInTheDocument()
  })

  it('keeps the Unblock button and explains when unblocking fails', async () => {
    mocks.unblockProfile.mockResolvedValueOnce({ ok: false, error: 'We could not update this relationship. Please try again.' })
    render(await BlockedMembersPage())

    fireEvent.click(screen.getByRole('button', { name: 'Unblock Rinki Mukharjee' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not update this relationship.'))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Unblock Rinki Mukharjee' })).toBeEnabled())
  })

  it('shows an empty state when nobody is blocked', async () => {
    mocks.listBlockedByViewer.mockResolvedValueOnce([])
    render(await BlockedMembersPage())

    expect(screen.getByText('You haven’t blocked anyone.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to My Network' })).toHaveAttribute('href', '/network')
  })
})
