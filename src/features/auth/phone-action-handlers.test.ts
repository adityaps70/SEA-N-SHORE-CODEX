import { describe, expect, it, vi } from 'vitest'
import { createPhoneAuthActionHandlers } from './phone-action-handlers'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

describe('phone auth action routing', () => {
  it('routes a sent OTP to the confirmation screen without exposing the phone number', async () => {
    const redirect = vi.fn()
    const handlers = createPhoneAuthActionHandlers({
      getActions: async () => ({
        requestOtp: vi.fn(async () => ({
          message: 'Verification code sent.',
          next: 'confirm-phone' as const,
        })),
        confirmOtp: vi.fn(),
      }),
      redirect,
    })

    await handlers.requestOtp({}, form({
      intent: 'sign-in',
      phoneNumber: '+919876543210',
    }))

    expect(redirect).toHaveBeenCalledWith('/auth/phone?intent=sign-in&step=confirm')
  })

  it('routes a verified OTP through the common post-sign-in resolver', async () => {
    const redirect = vi.fn()
    const handlers = createPhoneAuthActionHandlers({
      getActions: async () => ({
        requestOtp: vi.fn(),
        confirmOtp: vi.fn(async () => ({ message: 'Signed in.' })),
      }),
      redirect,
    })

    await handlers.confirmOtp({}, form({ code: '123456' }))

    expect(redirect).toHaveBeenCalledWith('/auth/post-sign-in')
  })

  it('keeps validation errors on the phone form', async () => {
    const redirect = vi.fn()
    const error = { error: 'Enter a valid mobile number.' }
    const handlers = createPhoneAuthActionHandlers({
      getActions: async () => ({
        requestOtp: vi.fn(async () => error),
        confirmOtp: vi.fn(),
      }),
      redirect,
    })

    await expect(handlers.requestOtp({}, form({
      intent: 'sign-up',
      phoneNumber: 'bad',
    }))).resolves.toEqual(error)
    expect(redirect).not.toHaveBeenCalled()
  })
})
