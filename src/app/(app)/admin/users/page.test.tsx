import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AdminUserSummary } from '@/features/admin/repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  searchUsers: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/lib/aws/storage', () => ({
  createMediaReadUrl: vi.fn(async (key: string) => `https://media.example/${key}?signed`),
}))
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
      limit: 51,
      offset: 0,
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

  it('can hide accounts that look like automated test accounts', async () => {
    const realMember: AdminUserSummary = { ...deletedRecord, id: 'u-real', fullName: 'Meera Kulkarni', slug: 'meera-k', email: 'meera@example.net', status: 'active' }
    const testMember: AdminUserSummary = { ...deletedRecord, id: 'u-test', fullName: 'E2E Recruiter 1', slug: 'e2e-recruiter-1', email: 'sea-n-shore-e2e-1@example.com', status: 'active' }
    mocks.searchUsers.mockResolvedValue([realMember, testMember])

    render(await AdminUsersPage({ searchParams: Promise.resolve({}) }))
    // Desktop table row and phone card.
    expect(screen.getAllByText('E2E Recruiter 1')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Hide them' })).toHaveAttribute('href', '/admin/users?test=hide')
    cleanup()

    render(await AdminUsersPage({ searchParams: Promise.resolve({ test: 'hide', status: 'active' }) }))
    expect(screen.queryByText('E2E Recruiter 1')).not.toBeInTheDocument()
    expect(screen.getAllByText('Meera Kulkarni')).toHaveLength(2)
    expect(screen.getByRole('link', { name: 'Show them' })).toHaveAttribute('href', '/admin/users?status=active')
    expect(screen.getByRole('link', { name: 'Suspended' })).toHaveAttribute('href', '/admin/users?status=suspended&test=hide')
  })

  it('shows each member’s profile photo, with initials when there is none', async () => {
    const withPhoto: AdminUserSummary = { ...deletedRecord, id: 'u-photo', fullName: 'Meera Kulkarni', slug: 'meera-k', email: 'meera@example.net', status: 'active', avatarPath: 'profiles/u-photo/avatar-1.jpg' }
    const withoutPhoto: AdminUserSummary = { ...deletedRecord, id: 'u-plain', fullName: 'Arjun Rao', slug: 'arjun-rao', email: 'arjun@example.net', status: 'active', avatarPath: null }
    mocks.searchUsers.mockResolvedValue([withPhoto, withoutPhoto])

    const { container } = render(await AdminUsersPage({ searchParams: Promise.resolve({}) }))

    const photos = container.querySelectorAll('tbody img')
    expect(photos).toHaveLength(1)
    expect(photos[0]).toHaveAttribute('src', 'https://media.example/profiles/u-photo/avatar-1.jpg?signed')
    expect(photos[0]).toHaveClass('rounded-full')
    expect(within(container.querySelector('tbody') as HTMLElement).getByText('AR')).toBeInTheDocument()
  })

  it('renders phones a card list (name first, role and status as label/value, actions in a "…" sheet) and keeps the table for desktop', async () => {
    const admin: AdminUserSummary = { ...deletedRecord, id: 'u-admin', fullName: 'Prakhar Pathak', slug: 'prakhar-pathak', headline: 'Seafarer', email: 'prakhar@example.net', status: 'active', isAdministrator: true }
    const member: AdminUserSummary = { ...deletedRecord, id: 'u-member', fullName: 'Rinki Mukharjee', slug: 'rinki', headline: 'Shore professional', email: 'rinki@example.net', status: 'suspended' }
    mocks.searchUsers.mockResolvedValue([admin, member])

    const { container } = render(await AdminUsersPage({ searchParams: Promise.resolve({}) }))

    expect(container.querySelector('table')?.parentElement).toHaveClass('max-md:hidden')
    const list = screen.getByRole('list', { name: 'User accounts' })
    expect(list).toHaveClass('md:hidden')
    const [first, second] = within(list).getAllByRole('listitem')
    expect(within(first).getByRole('link', { name: 'Prakhar Pathak' })).toHaveAttribute('href', '/admin/users/u-admin')
    expect(within(first).getByText('Seafarer · @prakhar-pathak')).toBeInTheDocument()
    expect(within(first).getByText('Role').nextElementSibling).toHaveTextContent('Admin')
    expect(within(first).getByText('Status').nextElementSibling).toHaveTextContent('Active')
    expect(within(second).getByText('Role').nextElementSibling).toHaveTextContent('Member')
    expect(within(second).getByText('Status').nextElementSibling).toHaveTextContent('Suspended')

    fireEvent.click(within(first).getByRole('button', { name: 'Actions for Prakhar Pathak' }))
    const sheet = screen.getByRole('dialog', { name: 'Prakhar Pathak' })
    expect(within(sheet).getByRole('menuitem', { name: 'Manage user' })).toHaveAttribute('href', '/admin/users/u-admin')
    expect(within(sheet).getByRole('menuitem', { name: 'View public profile' })).toHaveAttribute('href', '/people/prakhar-pathak')
  })

  it('pages through users 50 at a time and keeps the filters in the page links', async () => {
    const many = Array.from({ length: 51 }, (_, index): AdminUserSummary => ({
      ...deletedRecord, id: `u-${index}`, fullName: `Member ${index}`, slug: `member-${index}`, email: `m${index}@example.net`, status: 'active',
    }))
    mocks.searchUsers.mockResolvedValue(many)

    render(await AdminUsersPage({ searchParams: Promise.resolve({ status: 'active', page: '2' }) }))

    expect(mocks.searchUsers).toHaveBeenCalledWith('admin-1', { query: '', status: 'active', limit: 51, offset: 50 })
    expect(screen.queryByText('Member 50')).not.toBeInTheDocument()
    const pages = screen.getByRole('navigation', { name: 'User list pages' })
    expect(pages).toHaveTextContent('Page 2')
    expect(screen.getByRole('link', { name: 'Previous' })).toHaveAttribute('href', '/admin/users?status=active')
    expect(screen.getByRole('link', { name: 'Next' })).toHaveAttribute('href', '/admin/users?status=active&page=3')
    expect(screen.getByText(/50 results on page 2/)).toBeInTheDocument()
  })
})
