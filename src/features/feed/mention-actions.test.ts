import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getAwsNetworkProfiles: vi.fn(),
  searchMentionableOrganizations: vi.fn(),
}))

vi.mock('@/features/profiles/aws-queries', () => ({ getAwsNetworkProfiles: mocks.getAwsNetworkProfiles }))
vi.mock('@/features/organizations/mention-search-repository', () => ({
  organizationMentionSearchRepository: { searchMentionableOrganizations: mocks.searchMentionableOrganizations },
}))

import { searchMentionCandidates } from './mention-actions'

const member = { id: 'p1', slug: 'rahul-gupta', fullName: 'Rahul Gupta', avatarUrl: null, headline: 'Master Mariner', rank: 'Captain', currentCompany: 'Sea N Shore' }
const organization = { id: 'org-1', slug: 'sire-marine', name: 'SIRE Marine', logoUrl: '/api/company-logo/org-1?v=abc', subtitle: 'Ship manager · Chennai', verified: true }

describe('searchMentionCandidates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAwsNetworkProfiles.mockResolvedValue([member])
    mocks.searchMentionableOrganizations.mockResolvedValue([organization])
  })

  it('mixes members and organizations, members first, as a discriminated list', async () => {
    await expect(searchMentionCandidates(' si ')).resolves.toEqual([
      { kind: 'member', id: 'p1', slug: 'rahul-gupta', fullName: 'Rahul Gupta', avatarUrl: null, headline: 'Master Mariner', rank: 'Captain', currentCompany: 'Sea N Shore' },
      { kind: 'organization', id: 'org-1', slug: 'sire-marine', name: 'SIRE Marine', logoUrl: '/api/company-logo/org-1?v=abc', subtitle: 'Ship manager · Chennai' },
    ])
    expect(mocks.getAwsNetworkProfiles).toHaveBeenCalledWith(8, 'si')
    expect(mocks.searchMentionableOrganizations).toHaveBeenCalledWith('si', 5)
  })

  it('does not look up organizations for an empty query', async () => {
    await searchMentionCandidates('')
    expect(mocks.searchMentionableOrganizations).not.toHaveBeenCalled()
    expect(mocks.getAwsNetworkProfiles).toHaveBeenCalledWith(8, '')
  })

  it('keeps one list when the other fails', async () => {
    mocks.getAwsNetworkProfiles.mockRejectedValueOnce(new Error('down'))
    await expect(searchMentionCandidates('si')).resolves.toEqual([expect.objectContaining({ kind: 'organization', id: 'org-1' })])

    mocks.searchMentionableOrganizations.mockRejectedValueOnce(new Error('down'))
    await expect(searchMentionCandidates('si')).resolves.toEqual([expect.objectContaining({ kind: 'member', id: 'p1' })])
  })
})
