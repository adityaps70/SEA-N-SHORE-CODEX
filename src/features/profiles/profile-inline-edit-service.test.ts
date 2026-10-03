import { describe, expect, it, vi } from 'vitest'
import { createProfileInlineEditService } from './profile-inline-edit-service'
import { profilePreferencesSchema } from './profile-preferences'

const profileId = '11111111-1111-4111-8111-111111111111'

function fakeClient() {
  const statements: Array<{ text: string; values: readonly unknown[] }> = []
  const client = {
    query: vi.fn(async (text: string, values: readonly unknown[] = []) => {
      statements.push({ text, values })
      if (/for update/.test(text)) return { rows: [{ slug: 'aditya', username_change_count: 0, username_auto_generated: false }] }
      if (/returning id/.test(text)) return { rows: [{ id: profileId }] }
      return { rows: [] }
    }),
  }
  return { client, statements }
}

describe('profile card saves (round 11)', () => {
  it('saves a header profile type change and the organization and rank in one transaction, preferences first', async () => {
    const { client, statements } = fakeClient()
    const withTransaction = vi.fn(async (fn: (c: never) => Promise<unknown>) => fn(client as never))
    const service = createProfileInlineEditService({ withTransaction: withTransaction as never })
    const preferences = profilePreferencesSchema.parse({ persona: 'maritime_enthusiast', profileIntents: '["network"]' })

    await service.updateIdentity(
      profileId,
      { fullName: 'Aditya pratap singh', slug: 'aditya', headline: 'Maritime enthusiast', contactVisibility: 'members' },
      true,
      { rankSubmitted: true, preferences: { data: preferences, retained: { institutionName: 'IMU Chennai' } } },
    )

    expect(withTransaction).toHaveBeenCalledTimes(1)
    const order = statements.map(({ text }) => (
      /set profile_type/.test(text) ? 'preferences'
        : /current_company_id/.test(text) ? 'organization'
          : /set rank/.test(text) ? 'rank'
            : /full_name/.test(text) ? 'identity' : 'other'
    )).filter((step) => step !== 'other')
    expect(order).toEqual(['identity', 'preferences', 'organization', 'rank'])
    const preferencesUpdate = statements.find(({ text }) => /set profile_type/.test(text))!
    expect(preferencesUpdate.values).toContain('IMU Chennai')
    const organization = statements.find(({ text }) => /current_company_id/.test(text))!
    expect(organization.values).toEqual([profileId, null, null])
    const rank = statements.find(({ text }) => /set rank/.test(text))!
    expect(rank.values).toEqual([profileId, null])
  })

  it('sets or clears only the current organization from the Organizations card', async () => {
    const { client, statements } = fakeClient()
    const service = createProfileInlineEditService({ withTransaction: (async (fn: (c: never) => Promise<unknown>) => fn(client as never)) as never })
    await service.setCurrentOrganization(profileId, { currentCompany: 'Harbour Crew', currentCompanyId: '55555555-5555-4555-8555-555555555555' })
    expect(statements).toHaveLength(1)
    expect(statements[0]!.values).toEqual([profileId, 'Harbour Crew', '55555555-5555-4555-8555-555555555555'])
  })
})
