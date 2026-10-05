import { describe, expect, it, vi } from 'vitest'
import { createSignInIdentityRepository } from './sign-in-identity-repository'

describe('sign-in identity repository', () => {
  it('lists a profile’s Cognito sign-ins oldest first, mapped without phone data', async () => {
    const query = vi.fn(async () => [
      { id: 'a', provider_subject: 'sub-a', provider_username: 'google_123', email: 'Meera@Example.com', email_verified: true },
      { id: 'b', provider_subject: 'sub-b', provider_username: null, email: null, email_verified: null },
    ])
    const repository = createSignInIdentityRepository({ query })
    await expect(repository.listSignInIdentities('profile-1')).resolves.toEqual([
      { id: 'a', providerSubject: 'sub-a', providerUsername: 'google_123', email: 'Meera@Example.com', emailVerified: true },
      { id: 'b', providerSubject: 'sub-b', providerUsername: null, email: null, emailVerified: false },
    ])
    const [sql, values] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/from public\.identity_accounts/)
    expect(sql).toMatch(/provider = 'cognito'/)
    expect(sql).toMatch(/order by created_at asc, id asc/)
    expect(values).toEqual(['profile-1'])
  })
})
