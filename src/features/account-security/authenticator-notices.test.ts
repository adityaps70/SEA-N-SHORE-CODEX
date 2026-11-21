import { describe, expect, it, vi } from 'vitest'
import { authenticatorNotice, sendAuthenticatorNotice } from './authenticator-notices'

/** Admin two-step (owner, 21 Nov): the security emails. */
describe('authenticator notices', () => {
  it('says what happened and links from the site address', () => {
    const replaced = authenticatorNotice('replaced', 'https://staging.placeholder.example/')
    expect(replaced.subject).toBe('Your Sea N Shore authenticator app was changed')
    expect(replaced.text).toContain('https://staging.placeholder.example/settings/security')
    const reset = authenticatorNotice('reset_by_admin', 'https://staging.placeholder.example')
    expect(reset.subject).toBe('Sea N Shore reset your two-step verification')
    expect(reset.text).toContain('set up an authenticator app again')
  })

  it('sends once with an idempotency key, and never throws', async () => {
    const sendEmail = vi.fn(async () => ({ messageId: 'm-1' }))
    expect(await sendAuthenticatorNotice({ kind: 'replaced', to: 'member@placeholder.example', idempotencyKey: 'k-1', sender: { sendEmail } })).toBe(true)
    expect(sendEmail).toHaveBeenCalledWith(expect.objectContaining({ to: 'member@placeholder.example', idempotencyKey: 'k-1' }))
    expect(await sendAuthenticatorNotice({ kind: 'replaced', to: null, idempotencyKey: 'k-2', sender: { sendEmail } })).toBe(false)
    expect(await sendAuthenticatorNotice({ kind: 'replaced', to: 'member@placeholder.example', idempotencyKey: 'k-3', sender: { sendEmail: async () => { throw new Error('down') } } })).toBe(false)
    expect(await sendAuthenticatorNotice({ kind: 'replaced', to: 'member@placeholder.example', idempotencyKey: 'k-4', sender: null })).toBe(false)
  })
})
