import { describe, expect, it, vi } from 'vitest'
import { createCognitoUserAdmin } from './cognito-user-admin'
import { isPhoneLoginEmail } from './phone-login-email'

describe('Cognito user administration for account deletion', () => {
  it('deletes a Cognito user with AdminDeleteUser and treats an already-deleted one as done', async () => {
    const missing = Object.assign(new Error('gone'), { name: 'UserNotFoundException' })
    const client = { send: vi.fn<(command: unknown) => Promise<undefined>>(async () => undefined).mockRejectedValueOnce(missing) }
    const admin = createCognitoUserAdmin({ client: client as never, userPoolId: 'ap-south-1_pool', region: 'ap-south-1' })
    await expect(admin.deleteUser('uuid-user')).resolves.toBeUndefined()
    await expect(admin.deleteUser('uuid-user')).resolves.toBeUndefined()
    expect(client.send).toHaveBeenCalledTimes(2)
    const command = client.send.mock.calls[1]![0] as { constructor: { name: string }; input: Record<string, unknown> }
    expect(command.constructor.name).toBe('AdminDeleteUserCommand')
    expect(command.input).toEqual({ UserPoolId: 'ap-south-1_pool', Username: 'uuid-user' })

    const broken = { send: vi.fn(async () => { throw new Error('AccessDenied') }) }
    await expect(createCognitoUserAdmin({ client: broken as never, userPoolId: 'p', region: 'r' }).deleteUser('u')).rejects.toThrow('AccessDenied')
  })

  it('recognises the made-up email of a legacy mobile-only sign-in', () => {
    expect(isPhoneLoginEmail('phone-0123456789abcdef0123456789abcdef@auth.seaandshore.in')).toBe(true)
    expect(isPhoneLoginEmail('meera@example.com')).toBe(false)
    expect(isPhoneLoginEmail(null)).toBe(false)
  })
})
