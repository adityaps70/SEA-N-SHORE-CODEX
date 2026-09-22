import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeleteAccountPanel } from './delete-account-panel'

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mocks.replace }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DeleteAccountPanel', () => {
  it('explains what is deleted and what is anonymized before final confirmation', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountPanel />)

    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    expect(screen.getByText(/profile details, posts, comments, applications, connections/i)).toBeVisible()
    expect(screen.getByText(/messages you sent are removed from active conversation history/i)).toBeVisible()
    expect(screen.getByText(/published learning content.*may be retained in anonymized form/i)).toBeVisible()
    expect(screen.getByText(/audit and safety records.*anonymized/i)).toBeVisible()
  })

  it('requires both password re-authentication and exact DELETE confirmation', async () => {
    const user = userEvent.setup()
    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))

    const finalButton = screen.getByRole('button', { name: 'Permanently delete account' })
    expect(finalButton).toBeDisabled()

    await user.type(screen.getByLabelText('Current password'), 'CorrectPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delete')
    expect(finalButton).toBeDisabled()

    await user.clear(screen.getByLabelText('Type DELETE to confirm'))
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    expect(finalButton).toBeEnabled()
  })

  it('submits the deletion request and leaves the authenticated app after success', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: true,
      redirectTo: '/account-deleted',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))

    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText('Current password'), 'CorrectPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/account/delete', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
    })))
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body))).toEqual({
      password: 'CorrectPassword123',
      confirmation: 'DELETE',
    })
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/account-deleted'))
  })

  it('shows safe API errors without losing the confirmation form', async () => {
    const user = userEvent.setup()
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({
      ok: false,
      error: 'Your password could not be verified. Please try again.',
    }), {
      status: 401,
      headers: { 'content-type': 'application/json' },
    }))

    render(<DeleteAccountPanel />)
    await user.click(screen.getByRole('button', { name: 'Delete my account' }))
    await user.type(screen.getByLabelText('Current password'), 'WrongPassword123')
    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE')
    await user.click(screen.getByRole('button', { name: 'Permanently delete account' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Your password could not be verified. Please try again.')
    expect(screen.getByRole('button', { name: 'Permanently delete account' })).toBeEnabled()
  })
})
