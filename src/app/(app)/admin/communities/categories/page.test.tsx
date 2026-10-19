import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  listAll: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser }))
vi.mock('@/features/community/category-repository', () => ({ communityCategoryRepository: { listAll: mocks.listAll } }))
vi.mock('@/features/community/category-admin-actions', () => ({
  createCommunityCategory: vi.fn(),
  updateCommunityCategory: vi.fn(),
  moveCommunityCategory: vi.fn(),
  setCommunityCategoryHidden: vi.fn(),
  moveCommunityCategoryCommunities: vi.fn(),
  deleteCommunityCategory: vi.fn(),
}))

import CommunityCategoriesAdminPage from './page'

const search = (params: Record<string, string> = {}) => Promise.resolve(params)

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requirePlatformAdministratorUser.mockResolvedValue({ id: 'admin-1' })
  mocks.listAll.mockResolvedValue([
    { id: 'c1', slug: 'maritime-news', name: 'Maritime News', icon: 'Newspaper', hidden: false, description: null, position: 10, communityCount: 3 },
    { id: 'c2', slug: 'retired-topic', name: 'Retired Topic', icon: null, hidden: true, description: 'Old.', position: 20, communityCount: 0 },
  ])
})

describe('/admin/communities/categories (Round I, I2)', () => {
  it('is not found for members who are not platform administrators', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValue(new Error('admin_forbidden'))
    await expect(CommunityCategoriesAdminPage({ searchParams: search() })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.listAll).not.toHaveBeenCalled()
  })

  it('lists the categories in order with their controls: up/down, edit, hide/show, move communities or delete', async () => {
    render(await CommunityCategoriesAdminPage({ searchParams: search({ notice: 'moved', count: '3' }) }))
    expect(screen.getByRole('heading', { name: 'Community categories' })).toBeInTheDocument()
    expect(screen.getByText('Moved 3 communities.')).toHaveAttribute('role', 'status')
    const list = screen.getByRole('list', { name: 'Community categories, in directory order' })
    const [news, retired] = within(list).getAllByRole('listitem')
    expect(within(news!).getByText('1. Maritime News')).toBeInTheDocument()
    expect(within(news!).getByRole('button', { name: 'Move Maritime News up' })).toBeDisabled()
    expect(within(news!).getByRole('button', { name: 'Move Maritime News down' })).toBeEnabled()
    expect(within(news!).getByRole('button', { name: 'Hide Maritime News' })).toBeInTheDocument()
    // In use: no delete, but "Move its communities to…" with every other category.
    expect(within(news!).queryByText('Delete…')).not.toBeInTheDocument()
    expect(within(news!).getByText('Move its communities to…')).toBeInTheDocument()
    expect(within(news!).getByRole('button', { name: 'Move and delete Maritime News' })).toBeInTheDocument()
    // Hidden and empty: Show, and Delete after a confirm step.
    expect(within(retired!).getByText('Hidden')).toBeInTheDocument()
    expect(within(retired!).getByRole('button', { name: 'Show Retired Topic' })).toBeInTheDocument()
    expect(within(retired!).getByRole('button', { name: 'Delete Retired Topic for good' })).toBeInTheDocument()
    const add = screen.getByRole('region', { name: 'Add a category' })
    expect(within(add).getByRole('textbox', { name: /^Name/ })).toHaveAttribute('maxlength', '40')
    expect(within(add).getByRole('combobox', { name: 'Icon (optional)' })).toBeInTheDocument()
  })

  it('explains a refusal', async () => {
    render(await CommunityCategoriesAdminPage({ searchParams: search({ error: 'category_in_use' }) }))
    expect(screen.getByRole('alert')).toHaveTextContent('Communities still use this category. Move its communities to another category first.')
  })
})
