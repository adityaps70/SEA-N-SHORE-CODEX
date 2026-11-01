import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/client', () => ({ query: vi.fn() }))

const { isReservedRecipient, withEmailSuppression } = await import('./suppression')

describe('reserved recipients (Round ARCH: load-test accounts never get email)', () => {
  it.each([
    'loadtest-01@loadtest.seanshore.invalid',
    'someone@example.com',
    'a@mail.example.org',
    'e2e@staging.test',
    'x@localhost',
    'LOADTEST-02@LoadTest.SeaNShore.INVALID',
  ])('%s is reserved', (email) => {
    expect(isReservedRecipient(email)).toBe(true)
  })

  it.each(['member@gmail.com', 'crew@example-shipping.com', 'ops@notexample.com', 'invalid@seanshore.in', ''])('%s is not reserved', (email) => {
    expect(isReservedRecipient(email)).toBe(false)
  })

  it('refuses a reserved recipient before the sender or the do-not-email list is called', async () => {
    const send = vi.fn<(input: { to: string }) => Promise<{ id: string }>>(async () => ({ id: 'm1' }))
    const isSuppressed = vi.fn<(email: string) => Promise<boolean>>(async () => false)
    const client = withEmailSuppression({ sendEmail: send }, isSuppressed)
    await expect(client.sendEmail({ to: 'loadtest-07@loadtest.seanshore.invalid' })).rejects.toMatchObject({ code: 'recipient_do_not_email' })
    expect(send).not.toHaveBeenCalled()
    expect(isSuppressed).not.toHaveBeenCalled()
    await expect(client.sendEmail({ to: 'member@gmail.com' })).resolves.toEqual({ id: 'm1' })
  })
})
