import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  query: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/lib/db/client', () => ({ query: mocks.query }))

import { setPrivacyPreference } from './privacy-actions'
import { createPrivacyPreferences } from './privacy-preferences'
import { listSearchIndexableProfiles } from './repository'

const profileId = '11111111-1111-4111-8111-111111111111'

/** Round H (H5): "Let search engines show my profile" (member_preferences.allow_search_indexing). */
describe('search indexing preference', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: profileId })
    mocks.query.mockResolvedValue([])
  })

  it('reads off by default, on only when stored as true, and off when the read fails', async () => {
    const rows = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ allow_search_indexing: true }]).mockRejectedValueOnce(new Error('db down'))
    const preferences = createPrivacyPreferences({ query: rows })

    expect(await preferences.allowsSearchIndexing(profileId)).toBe(false)
    expect(await preferences.allowsSearchIndexing(profileId)).toBe(true)
    expect(await preferences.allowsSearchIndexing(profileId)).toBe(false)
    expect(rows).toHaveBeenCalledWith(expect.stringContaining('select allow_search_indexing from public.member_preferences'), [profileId])
  })

  it('includes the switch in the settings read', async () => {
    const preferences = createPrivacyPreferences({ query: vi.fn().mockResolvedValue([{ show_in_people_suggestions: true, open_to_recruiters: false, allow_search_indexing: true }]) })
    expect(await preferences.get(profileId)).toEqual({ showInPeopleSuggestions: true, openToRecruiters: false, allowSearchIndexing: true })
    const empty = createPrivacyPreferences({ query: vi.fn().mockResolvedValue([]) })
    expect((await empty.get(profileId)).allowSearchIndexing).toBe(false)
  })

  it('saves the switch from Settings › Privacy into allow_search_indexing', async () => {
    expect(await setPrivacyPreference('allowSearchIndexing', true)).toEqual({ ok: true, value: true })

    expect(mocks.query).toHaveBeenCalledTimes(1)
    const [sql, values] = mocks.query.mock.calls[0]!
    expect(sql).toContain('insert into public.member_preferences (profile_id, allow_search_indexing, updated_at)')
    expect(sql).toContain('do update set allow_search_indexing = excluded.allow_search_indexing')
    expect(values).toEqual([profileId, true])
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/settings/privacy')
  })

  it('turns it off again and rejects unknown settings or values', async () => {
    expect(await setPrivacyPreference('allowSearchIndexing', false)).toEqual({ ok: true, value: false })
    expect(mocks.query.mock.calls[0]![1]).toEqual([profileId, false])

    mocks.query.mockClear()
    expect(await setPrivacyPreference('allowSearchIndexingEverywhere', true)).toEqual({ ok: false, error: 'Unknown setting.' })
    expect(await setPrivacyPreference('allowSearchIndexing', 'yes' as unknown as boolean)).toEqual({ ok: false, error: 'Unknown setting.' })
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it('lists only active, onboarded profiles that opted in for the sitemap', async () => {
    const rows = vi.fn().mockResolvedValue([
      { slug: 'opted-in-member', updated_at: new Date('2026-10-05T00:00:00.000Z') },
      { slug: null, updated_at: '2026-10-04T00:00:00.000Z' },
    ])

    expect(await listSearchIndexableProfiles(10, rows)).toEqual([{ slug: 'opted-in-member', updatedAt: '2026-10-05T00:00:00.000Z' }])
    const [sql, values] = rows.mock.calls[0]!
    expect(sql).toContain('preference.allow_search_indexing')
    expect(sql).toContain("p.account_status = 'active'")
    expect(sql).toContain('p.onboarding_completed_at is not null')
    expect(values).toEqual([10])
  })
})
