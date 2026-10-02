import { describe, expect, it, vi } from 'vitest'

describe('Cognito pre-sign-up Google account linker', () => {
  async function load() {
    return import('../../../infra/aws/app/lambda/cognito-pre-sign-up-link.mjs')
  }

  function event(overrides = {}) {
    return {
      triggerSource: 'PreSignUp_ExternalProvider',
      userPoolId: 'ap-south-1_example',
      userName: 'Google_1234567890',
      request: {
        userAttributes: {
          email: 'member@example.com',
          email_verified: 'true',
        },
      },
      response: {},
      ...overrides,
    }
  }

  it('links a verified Google identity to exactly one existing local Cognito user', async () => {
    const send = vi.fn()
      .mockResolvedValueOnce({
        Users: [{
          Username: '11111111-1111-4111-8111-111111111111',
          UserStatus: 'CONFIRMED',
          Enabled: true,
          Attributes: [
            { Name: 'email', Value: 'member@example.com' },
            { Name: 'email_verified', Value: 'true' },
          ],
        }],
      })
      .mockResolvedValueOnce({})

    const { createHandler } = await load()
    const handler = createHandler({ client: { send } })
    await expect(handler(event())).resolves.toMatchObject({ userName: 'Google_1234567890' })

    expect(send).toHaveBeenCalledTimes(2)
    const listCommand = send.mock.calls[0]?.[0]
    expect(listCommand?.input).toMatchObject({
      UserPoolId: 'ap-south-1_example',
      Filter: 'email = "member@example.com"',
    })

    const linkCommand = send.mock.calls[1]?.[0]
    expect(linkCommand?.input).toEqual({
      UserPoolId: 'ap-south-1_example',
      DestinationUser: {
        ProviderName: 'Cognito',
        ProviderAttributeValue: '11111111-1111-4111-8111-111111111111',
      },
      SourceUser: {
        ProviderName: 'Google',
        ProviderAttributeName: 'Cognito_Subject',
        ProviderAttributeValue: '1234567890',
      },
    })
  })

  it('does not link when Google did not provide a verified email', async () => {
    const send = vi.fn()
    const { createHandler } = await load()
    const handler = createHandler({ client: { send } })
    const input = event()
    input.request.userAttributes.email_verified = 'false'

    await expect(handler(input)).resolves.toBe(input)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not affect ordinary local sign-up', async () => {
    const send = vi.fn()
    const { createHandler } = await load()
    const handler = createHandler({ client: { send } })
    const input = event({ triggerSource: 'PreSignUp_SignUp', userName: 'member@example.com' })

    await expect(handler(input)).resolves.toBe(input)
    expect(send).not.toHaveBeenCalled()
  })

  it('fails closed when more than one local verified account matches', async () => {
    const send = vi.fn().mockResolvedValueOnce({
      Users: [
        {
          Username: '11111111-1111-4111-8111-111111111111',
          UserStatus: 'CONFIRMED',
          Enabled: true,
          Attributes: [{ Name: 'email_verified', Value: 'true' }],
        },
        {
          Username: '22222222-2222-4222-8222-222222222222',
          UserStatus: 'CONFIRMED',
          Enabled: true,
          Attributes: [{ Name: 'email_verified', Value: 'true' }],
        },
      ],
    })
    const { createHandler } = await load()
    const handler = createHandler({ client: { send } })

    await expect(handler(event())).rejects.toThrow('ambiguous_existing_account')
    expect(send).toHaveBeenCalledTimes(1)
  })
})
