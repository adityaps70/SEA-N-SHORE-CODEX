import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requirePlatformAdministratorUser: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
}))
vi.mock('@/features/admin/access', () => ({
  requirePlatformAdministratorUser: mocks.requirePlatformAdministratorUser,
}))

import AdminLayout from './layout'

describe('admin route boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders the admin workspace for an authorized administrator', async () => {
    mocks.requirePlatformAdministratorUser.mockResolvedValueOnce({
      id: '11111111-1111-4111-8111-111111111111',
      cognitoSub: 'sub-admin',
      email: 'admin@example.com',
    })

    render(await AdminLayout({ children: <div>Restricted workspace</div> }))

    expect(screen.getByText('Restricted workspace')).toBeInTheDocument()
    expect(mocks.notFound).not.toHaveBeenCalled()
  })

  it('returns not found for a signed-in user without administrator access', async () => {
    mocks.requirePlatformAdministratorUser.mockRejectedValueOnce(new Error('admin_forbidden'))

    await expect(AdminLayout({ children: <div>Restricted workspace</div> })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledTimes(1)
  })
})
