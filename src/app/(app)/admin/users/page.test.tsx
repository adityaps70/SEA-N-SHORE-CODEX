import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserSummary } from '@/features/admin/repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  searchUsers: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/admin/repository')>()
  return {
    ...original,
    adminRepository: {
      searchUsers: mocks.searchUsers,
    },
  }
})

import AdminUsersPage from './page'

const deletedRecord: AdminUserSummary = {
  id: '55555555-5555-4555-8555-555555555555',
  fullName: 'Deleted member',
  slug: null,
  headline: null,
  email: null,
  cognitoSubject: null,
  status: 'deletion_requested',
  isAdministrator: false,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-09-23T10:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('/admin/users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.searchUsers.mockResolvedValue([])
  })

  it('treats permanently deleted profiles as audit records rather than manageable users', async () => {
    mocks.searchUsers.mockResolvedValueOnce([deletedRecord])

    render(await AdminUsersPage({
      searchParams: Promise.resolve({ status: 'deletion_requested' }),
    }))

    expect(mocks.searchUsers).toHaveBeenCalledWith('admin-1', {
      query: '',
      status: 'deletion_requested',
      limit: 100,
    })
    expect(screen.getByRole('heading', { name: 'Deleted account records' })).toBeInTheDocument()
    expect(screen.getByText(/retained only so moderation history and integrity records remain traceable/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'View deletion record' })).toHaveAttribute(
      'href',
      '/admin/users/55555555-5555-4555-8555-555555555555',
    )
    expect(screen.queryByRole('link', { name: 'Manage user' })).not.toBeInTheDocument()
  })

  it('labels the normal queue as user accounts and keeps deletion records separate', async () => {
    render(await AdminUsersPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByRole('heading', { name: 'User accounts' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Deletion records' })).toBeInTheDocument()
  })
})
