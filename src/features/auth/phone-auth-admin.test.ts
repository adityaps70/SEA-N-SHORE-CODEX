import { describe, expect, it, vi } from 'vitest'
import { createPhoneAuthAdmin } from './phone-auth-admin'

describe('phone auth Cognito administration', () => {
  it('finds exactly one verified Cognito user for a phone number', async () => {
    const client = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        expect(command.constructor.name).toBe('ListUsersCommand')
        expect(command.input).toMatchObject({
          UserPoolId: 'ap-south-1_pool',
          Filter: 'phone_number = "+919876543210"',
          Limit: 2,
        })
        return {
          Users: [{
            Username: 'uuid-user',
            Attributes: [
              { Name: 'phone_number', Value: '+919876543210' },
              { Name: 'phone_number_verified', Value: 'true' },
            ],
          }],
        }
      }),
    }

    const admin = createPhoneAuthAdmin({
      client: client as never,
      userPoolId: 'ap-south-1_pool',
      region: 'ap-south-1',
      randomPassword: () => 'RandomSecret123!random',
    })

    await expect(admin.findUserByPhone('+919876543210')).resolves.toEqual({
      username: 'uuid-user',
      verified: true,
    })
    await expect(admin.findVerifiedUserByPhone('+919876543210')).resolves.toEqual({
      username: 'uuid-user',
    })
  })

  it('fails closed when the phone number resolves to multiple Cognito users', async () => {
    const client = {
      send: vi.fn(async () => ({
        Users: [
          { Username: 'one', Attributes: [{ Name: 'phone_number_verified', Value: 'true' }] },
          { Username: 'two', Attributes: [{ Name: 'phone_number_verified', Value: 'true' }] },
        ],
      })),
    }
    const admin = createPhoneAuthAdmin({
      client: client as never,
      userPoolId: 'ap-south-1_pool',
      region: 'ap-south-1',
    })

    await expect(admin.findUserByPhone('+919876543210')).rejects.toThrow(
      'phone_identity_ambiguous',
    )
  })


  it('returns an existing unverified phone user so signup can safely resume', async () => {
    const client = {
      send: vi.fn(async () => ({
        Users: [{
          Username: 'pending-user',
          Attributes: [
            { Name: 'phone_number', Value: '+919876543210' },
            { Name: 'phone_number_verified', Value: 'false' },
          ],
        }],
      })),
    }
    const admin = createPhoneAuthAdmin({
      client: client as never,
      userPoolId: 'ap-south-1_pool',
      region: 'ap-south-1',
    })

    await expect(admin.findUserByPhone('+919876543210')).resolves.toEqual({
      username: 'pending-user',
      verified: false,
    })
  })

  it('creates a confirmed Cognito user without sending a password message', async () => {
    const calls: Array<{ name: string; input: Record<string, unknown> }> = []
    const client = {
      send: vi.fn(async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
        calls.push({ name: command.constructor.name, input: command.input })
        if (command.constructor.name === 'AdminCreateUserCommand') {
          return { User: { Username: 'new-phone-user' } }
        }
        return {}
      }),
    }
    const admin = createPhoneAuthAdmin({
      client: client as never,
      userPoolId: 'ap-south-1_pool',
      region: 'ap-south-1',
      randomPassword: () => 'RandomSecret123!random',
      syntheticEmailForPhone: () => 'phone-stable@auth.seaandshore.in',
    })

    await expect(admin.createPhoneUser({
      phoneNumber: '+919876543210',
      fullName: 'Captain Phone',
    })).resolves.toEqual({ username: 'new-phone-user' })

    expect(calls[0]).toEqual({
      name: 'AdminCreateUserCommand',
      input: {
        UserPoolId: 'ap-south-1_pool',
        Username: 'phone-stable@auth.seaandshore.in',
        MessageAction: 'SUPPRESS',
        UserAttributes: [
          { Name: 'name', Value: 'Captain Phone' },
          { Name: 'phone_number', Value: '+919876543210' },
        ],
      },
    })
    expect(calls[1]).toMatchObject({
      name: 'AdminSetUserPasswordCommand',
      input: {
        UserPoolId: 'ap-south-1_pool',
        Username: 'new-phone-user',
        Password: 'RandomSecret123!random',
        Permanent: true,
      },
    })
  })

  it('marks the phone attribute verified only after OTP authentication succeeds', async () => {
    const client = { send: vi.fn(async () => ({})) }
    const admin = createPhoneAuthAdmin({
      client: client as never,
      userPoolId: 'ap-south-1_pool',
      region: 'ap-south-1',
    })

    await admin.markPhoneVerified('uuid-user')

    const command = client.send.mock.calls[0]?.[0] as { constructor: { name: string }; input: Record<string, unknown> }
    expect(command.constructor.name).toBe('AdminUpdateUserAttributesCommand')
    expect(command.input).toEqual({
      UserPoolId: 'ap-south-1_pool',
      Username: 'uuid-user',
      UserAttributes: [{ Name: 'phone_number_verified', Value: 'true' }],
    })
  })
})
