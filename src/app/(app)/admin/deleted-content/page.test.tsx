import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeletedPostRecord } from '@/features/admin/repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listDeletedPosts: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/admin/repository')>()
  return {
    ...original,
    adminRepository: {
      listDeletedPosts: mocks.listDeletedPosts,
    },
  }
})
vi.mock('@/features/admin/components/deleted-post-recovery-panel', () => ({
  DeletedPostRecoveryPanel: ({ postId, recoverable }: { postId: string; recoverable: boolean }) => (
    <div data-testid="recovery-panel">{postId}:{String(recoverable)}</div>
  ),
}))

import DeletedContentPage from './page'

const record: DeletedPostRecord = {
  id: '22222222-2222-4222-8222-222222222222',
  body: 'Safety discussion removed from the public feed.',
  category: 'safety_lessons',
  author: {
    id: '33333333-3333-4333-8333-333333333333',
    fullName: 'Capt. Example',
    slug: 'capt-example',
  },
  deletedAt: '2026-09-20T10:00:00.000Z',
  deletedBy: {
    id: '11111111-1111-4111-8111-111111111111',
    fullName: 'Platform Admin',
  },
  reason: 'Confirmed spam after moderation review.',
  purgeAfter: '2026-10-20T10:00:00.000Z',
  recoverable: true,
}

afterEach(() => {
  cleanup()
})

describe('/admin/deleted-content', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.listDeletedPosts.mockResolvedValue([record])
  })

  it('shows deleted post recovery metadata and the 30-day retention policy', async () => {
    render(await DeletedContentPage())

    expect(mocks.listDeletedPosts).toHaveBeenCalledWith('admin-1', 100)
    expect(screen.getByRole('heading', { name: 'Deleted content & recovery' })).toBeInTheDocument()
    expect(screen.getByText(/30 days/i)).toBeInTheDocument()
    expect(screen.getByText('Capt. Example')).toBeInTheDocument()
    expect(screen.getByText('Platform Admin')).toBeInTheDocument()
    expect(screen.getByText('Confirmed spam after moderation review.')).toBeInTheDocument()
    expect(screen.getByText(/Safety discussion removed from the public feed/i)).toBeInTheDocument()
    expect(screen.getByTestId('recovery-panel')).toHaveTextContent(record.id)
  })

  it('shows an empty state when there are no retained deleted posts', async () => {
    mocks.listDeletedPosts.mockResolvedValueOnce([])

    render(await DeletedContentPage())

    expect(screen.getByText('No deleted posts are currently being retained.')).toBeInTheDocument()
  })
})
