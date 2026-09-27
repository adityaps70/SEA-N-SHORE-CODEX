import { describe, expect, it, vi } from 'vitest'
import type { NetworkConnectionRow } from '@/features/network/types'
import type { PublicProfile } from '@/features/profiles/types'
import { createMessageRecipientSearch, normalizeMessageRecipientQuery } from './recipients'

const VIEWER_ID = '11111111-1111-4111-8111-111111111111'
const ANITA_ID = '22222222-2222-4222-8222-222222222222'
const ARJUN_ID = '33333333-3333-4333-8333-333333333333'
const PENDING_OUT_ID = '44444444-4444-4444-8444-444444444444'
const PENDING_IN_ID = '55555555-5555-4555-8555-555555555555'
const CONVERSATION_ID = '66666666-6666-4666-8666-666666666666'

function connection(peerId: string, status: 'accepted' | 'pending', requestedBy = VIEWER_ID): NetworkConnectionRow {
  const [low, high] = [VIEWER_ID, peerId].sort()
  return {
    id: `connection-${peerId}`,
    user_low_id: low!,
    user_high_id: high!,
    requested_by: requestedBy,
    status,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
  }
}

function profile(id: string, fullName: string, extra: Partial<PublicProfile> = {}): PublicProfile {
  return {
    id,
    slug: fullName.toLowerCase().replace(/[^a-z]+/g, '-'),
    profileType: 'seafarer',
    fullName,
    avatarPath: null,
    location: null,
    headline: null,
    summary: null,
    rank: null,
    currentCompany: null,
    currentVessel: null,
    sailingExperienceYears: null,
    vesselTypes: [],
    tradingAreas: [],
    shoreCareerPreference: false,
    availability: null,
    skills: [],
    ...extra,
  } as PublicProfile
}

function makeSearch(overrides: {
  connections?: NetworkConnectionRow[]
  profiles?: PublicProfile[]
} = {}) {
  const profiles = overrides.profiles ?? [
    profile(ANITA_ID, 'Capt. Anita Singh', { rank: 'Master', currentCompany: 'Blue Ocean Tankers' }),
    profile(ARJUN_ID, 'Arjun Rao', { headline: 'Chief Officer' }),
    profile(PENDING_OUT_ID, 'Anil Pending'),
    profile(PENDING_IN_ID, 'Anu Incoming'),
    // A malformed graph that includes the viewer must never surface the viewer.
    profile(VIEWER_ID, 'Viewer Self'),
  ]
  const deps = {
    requireUser: vi.fn(async () => ({ id: VIEWER_ID })),
    loadViewerGraph: vi.fn(async () => ({
      connections: overrides.connections ?? [
        connection(ANITA_ID, 'accepted'),
        connection(ARJUN_ID, 'accepted', ARJUN_ID),
        connection(PENDING_OUT_ID, 'pending', VIEWER_ID),
        connection(PENDING_IN_ID, 'pending', PENDING_IN_ID),
        { ...connection(ANITA_ID, 'accepted'), user_low_id: VIEWER_ID, user_high_id: VIEWER_ID },
      ],
    })),
    loadProfiles: vi.fn(async ({ ids }: { ids: string[] }) => profiles.filter((item) => ids.includes(item.id))),
    loadHydratedProfiles: vi.fn(async (ids: string[]) => profiles
      .filter((item) => ids.includes(item.id))
      .map((item) => ({ ...item, avatarUrl: `https://signed.example/${item.id}.webp` }))),
    listDirectConversationsWithPeers: vi.fn(async () => new Map([
      [ANITA_ID, { conversationId: CONVERSATION_ID, lastMessageAt: '2026-09-20T10:00:00.000Z' }],
    ])),
  }
  return { search: createMessageRecipientSearch(deps), deps }
}

describe('message recipient search', () => {
  it('lists accepted connections only, never the viewer, and reuses an existing conversation', async () => {
    const { search, deps } = makeSearch()

    const result = await search('')

    expect(result.connectionCount).toBe(2)
    expect(result.recipients.map((recipient) => recipient.profileId)).toEqual([ANITA_ID, ARJUN_ID])
    expect(result.recipients.some((recipient) => recipient.profileId === VIEWER_ID)).toBe(false)
    expect(result.recipients[0]).toMatchObject({
      name: 'Capt. Anita Singh',
      subtitle: 'Master · Blue Ocean Tankers',
      conversationId: CONVERSATION_ID,
      status: 'available',
      unavailableReason: null,
      avatarUrl: `https://signed.example/${ANITA_ID}.webp`,
    })
    expect(result.recipients[1]).toMatchObject({ conversationId: null, status: 'available' })
    expect(deps.listDirectConversationsWithPeers).toHaveBeenCalledWith(VIEWER_ID, [ANITA_ID, ARJUN_ID])
  })

  it('filters by name, rank or company and explains why pending connections cannot be messaged', async () => {
    const { search } = makeSearch()

    const result = await search('  an  ')

    expect(result.query).toBe('an')
    const byId = new Map(result.recipients.map((recipient) => [recipient.profileId, recipient]))
    expect(byId.get(ANITA_ID)?.status).toBe('available')
    expect(byId.get(PENDING_OUT_ID)).toMatchObject({
      status: 'request_sent',
      conversationId: null,
      unavailableReason: expect.stringContaining('pending'),
    })
    expect(byId.get(PENDING_IN_ID)).toMatchObject({
      status: 'request_received',
      unavailableReason: expect.stringContaining('Accept it in My Network'),
    })
    expect(byId.has(VIEWER_ID)).toBe(false)
    // Messageable people are always listed before people who cannot be messaged yet.
    expect(result.recipients[0]?.status).toBe('available')

    const byCompany = await search('blue ocean')
    expect(byCompany.recipients.map((recipient) => recipient.profileId)).toEqual([ANITA_ID])
  })

  it('returns an empty result without loading profiles when the member has no connections', async () => {
    const { search, deps } = makeSearch({ connections: [] })

    await expect(search('anyone')).resolves.toEqual({ query: 'anyone', recipients: [], connectionCount: 0 })
    expect(deps.loadProfiles).not.toHaveBeenCalled()
  })

  it('bounds and normalises the search text', () => {
    expect(normalizeMessageRecipientQuery('  Capt.   Anita ')).toBe('Capt. Anita')
    expect(normalizeMessageRecipientQuery(42)).toBe('')
    expect(normalizeMessageRecipientQuery('x'.repeat(200))).toHaveLength(80)
  })
})
