import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AdminUserControlPanel } from './admin-user-control-panel'

const profileId = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })))
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { reload: vi.fn() },
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('AdminUserControlPanel', () => {
  it('keeps suspension visibly available and explains when a moderation reason is still required', async () => {
    const user = userEvent.setup()
    render(<AdminUserControlPanel profileId={profileId} status="active" isAdministrator={false} />)

    const suspend = screen.getByRole('button', { name: 'Suspend account' })
    expect(suspend).toBeEnabled()

    await user.click(suspend)
    expect(screen.getByRole('status')).toHaveTextContent(/enter at least 10 characters/i)
    expect(fetch).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Moderation reason'), 'Repeated unsafe recruitment messages.')
    await user.click(suspend)

    await waitFor(() => expect(fetch).toHaveBeenCalledWith(
      `/api/admin/users/${profileId}/status`,
      expect.objectContaining({ method: 'POST' }),
    ))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      action: 'suspend',
      reason: 'Repeated unsafe recruitment messages.',
    })
  })

  it('clearly explains restore versus permanent deletion for a suspended account', () => {
    render(<AdminUserControlPanel profileId={profileId} status="suspended" isAdministrator={false} />)

    expect(screen.getByRole('heading', { name: 'Suspended account — choose what happens next' })).toBeInTheDocument()
    expect(screen.getByText(/temporary suspension/i)).toBeInTheDocument()
    expect(screen.getByText(/all existing account data is retained/i)).toBeInTheDocument()
    expect(screen.getByText(/permanent deletion/i)).toBeInTheDocument()
    expect(screen.getByText(/cannot be restored/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Restore account' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument()
  })

  it('lets the admin open permanent deletion before entering a reason but requires reason and DELETE to confirm', async () => {
    const user = userEvent.setup()
    render(<AdminUserControlPanel profileId={profileId} status="suspended" isAdministrator={false} />)

    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }))

    const confirmDelete = screen.getByRole('button', { name: 'Confirm permanent deletion' })
    expect(confirmDelete).toBeDisabled()

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(confirmDelete).toBeDisabled()

    await user.type(screen.getByLabelText('Moderation reason'), 'Fraudulent account confirmed after review.')
    expect(confirmDelete).toBeEnabled()
  })

  it('does not expose destructive controls for administrator accounts', () => {
    render(<AdminUserControlPanel profileId={profileId} status="active" isAdministrator />)

    expect(screen.queryByRole('button', { name: 'Suspend account' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Permanently delete account' })).not.toBeInTheDocument()
    expect(screen.getByText(/administrator accounts are protected/i)).toBeInTheDocument()
  })
})
