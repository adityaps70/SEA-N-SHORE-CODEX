import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  requestPhoneLinkCode: vi.fn(),
  confirmPhoneLinkCode: vi.fn(),
  removeLinkedPhone: vi.fn(),
  cancelPhoneLink: vi.fn(async () => ({ status: 'idle' })),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/features/auth/phone-link-actions', () => ({
  requestPhoneLinkCode: mocks.requestPhoneLinkCode,
  confirmPhoneLinkCode: mocks.confirmPhoneLinkCode,
  removeLinkedPhone: mocks.removeLinkedPhone,
  cancelPhoneLink: mocks.cancelPhoneLink,
}))

import { AccountPhonePanel } from './account-phone-panel'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('AccountPhonePanel', () => {
  it('adds a number with a country code, then verifies the texted code', async () => {
    const user = userEvent.setup()
    mocks.requestPhoneLinkCode.mockResolvedValueOnce({ status: 'code_sent', phoneNumber: '+6581234567', message: 'We sent a 6-digit code to +6581234567.' })
    mocks.confirmPhoneLinkCode.mockResolvedValueOnce({ status: 'verified', phoneNumber: '+6581234567', message: 'Your mobile number is verified.' })
    render(<AccountPhonePanel summary={{ phones: [], pendingPhoneNumber: null }} />)

    expect(screen.getByText('No mobile number on your account yet.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add mobile number' }))
    await user.selectOptions(screen.getByLabelText('Country code'), '+65')
    await user.type(screen.getByRole('textbox', { name: 'Mobile number' }), '8123 4567')
    await user.click(screen.getByRole('button', { name: 'Send code' }))

    await waitFor(() => expect(mocks.requestPhoneLinkCode).toHaveBeenCalledTimes(1))
    const sent = mocks.requestPhoneLinkCode.mock.calls[0]![1] as FormData
    expect(sent.get('countryCode')).toBe('+65')
    expect(sent.get('phoneNumber')).toBe('8123 4567')
    expect(await screen.findByRole('status')).toHaveTextContent('We sent a 6-digit code')

    await user.type(screen.getByLabelText(/Code sent to/), '123456')
    await user.click(screen.getByRole('button', { name: 'Verify number' }))
    await waitFor(() => expect(mocks.confirmPhoneLinkCode).toHaveBeenCalledTimes(1))
    expect((mocks.confirmPhoneLinkCode.mock.calls[0]![1] as FormData).get('code')).toBe('123456')
    expect(await screen.findByText('Your mobile number is verified.')).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows why a number cannot be used, such as another account owning it', async () => {
    const user = userEvent.setup()
    mocks.requestPhoneLinkCode.mockResolvedValueOnce({ status: 'error', step: 'request', error: 'This mobile number is already used by another Sea N Shore account.' })
    render(<AccountPhonePanel summary={{ phones: [], pendingPhoneNumber: null }} />)
    await user.click(screen.getByRole('button', { name: 'Add mobile number' }))
    await user.type(screen.getByRole('textbox', { name: 'Mobile number' }), '9876543210')
    await user.click(screen.getByRole('button', { name: 'Send code' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('already used by another Sea N Shore account')
    expect(screen.getByRole('button', { name: 'Send code' })).toBeInTheDocument()
  })

  it('lists the verified number, offers to change it, and removes it when allowed', async () => {
    const user = userEvent.setup()
    mocks.removeLinkedPhone.mockResolvedValueOnce({ status: 'removed', message: 'Your mobile number was removed.' })
    render(<AccountPhonePanel summary={{
      phones: [{ identityId: 'identity-phone', phoneNumber: '+919876543210', current: false, removable: true, removeBlockedReason: null }],
      pendingPhoneNumber: null,
    }} />)
    expect(screen.getByText('+91 98765 43210')).toBeInTheDocument()
    expect(screen.getByText('Verified')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change mobile number' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(mocks.removeLinkedPhone).toHaveBeenCalledTimes(1))
    expect((mocks.removeLinkedPhone.mock.calls[0]![1] as FormData).get('identityId')).toBe('identity-phone')
    expect(await screen.findByText('Your mobile number was removed.')).toBeInTheDocument()
  })

  it('explains when the number cannot be removed and resumes a pending verification', () => {
    render(<AccountPhonePanel summary={{
      phones: [{ identityId: 'identity-phone', phoneNumber: '+919876543210', current: true, removable: false, removeBlockedReason: 'This number is the only way you sign in, so it can’t be removed.' }],
      pendingPhoneNumber: '+919111111111',
    }} />)
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument()
    expect(screen.getByText(/only way you sign in/)).toBeInTheDocument()
    expect(screen.getByLabelText('Code sent to +91 91111 11111')).toBeInTheDocument()
  })
})
