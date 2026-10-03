import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAwsOwnProfile: vi.fn(),
  updateIdentity: vi.fn(),
  updateGoals: vi.fn(),
  setCurrentOrganization: vi.fn(),
  getListableOrganization: vi.fn(),
  listProfileOrganizations: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/moderation/repository', () => ({ moderationRepository: { flagContentAutomatically: vi.fn() } }))
vi.mock('./aws-queries', () => ({ getAwsOwnProfile: mocks.getAwsOwnProfile }))
vi.mock('./profile-inline-edit-service', () => ({
  updateProfileAboutSectionWithAurora: vi.fn(),
  updateProfileIdentitySectionWithAurora: mocks.updateIdentity,
  updateProfileProfessionalSectionWithAurora: vi.fn(),
  updateProfileGoalsSectionWithAurora: mocks.updateGoals,
  setProfileCurrentOrganizationWithAurora: mocks.setCurrentOrganization,
}))
vi.mock('./organization-link-repository', () => ({
  organizationLinkRepository: {
    getListableOrganization: mocks.getListableOrganization,
    listProfileOrganizations: mocks.listProfileOrganizations,
  },
}))

import {
  updateProfileCurrentOrganization,
  updateProfileGoalsSection,
  updateProfileIdentitySection,
} from './profile-inline-actions'

const profileId = '11111111-1111-4111-8111-111111111111'
const organizationId = '55555555-5555-4555-8555-555555555555'

const enthusiast = {
  id: profileId,
  slug: 'aditya-pratap-singh',
  profileType: 'maritime_professional',
  identityRoot: 'professional',
  persona: 'maritime_enthusiast',
  profileIntents: ['network'],
  rank: 'captain',
  currentCompany: 'ig computers',
  institutionName: null,
  communityRelationship: null,
  specialization: null,
}

function headerForm(values: Record<string, string> = {}) {
  const form = new FormData()
  const entries = {
    persona: 'maritime_enthusiast',
    fullName: 'Aditya pratap singh',
    slug: 'aditya-pratap-singh',
    headline: 'Maritime enthusiast',
    location: 'Lucknow',
    currentCompany: 'ig computers',
    currentCompanyId: '',
    rank: 'captain',
    contactVisibility: 'members',
    ...values,
  }
  for (const [name, value] of Object.entries(entries)) form.set(name, value)
  return form
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: profileId })
  mocks.getAwsOwnProfile.mockResolvedValue(enthusiast)
  mocks.updateIdentity.mockResolvedValue(true)
  mocks.updateGoals.mockResolvedValue(true)
  mocks.setCurrentOrganization.mockResolvedValue(true)
})

describe('header card action (round 11)', () => {
  it('clears a saved organization and rank for a Maritime Enthusiast', async () => {
    await expect(updateProfileIdentitySection({}, headerForm({ currentCompany: '', rank: '' }))).resolves.toMatchObject({ success: true })

    const [id, identity, saveOrganization, options] = mocks.updateIdentity.mock.calls[0]!
    expect(id).toBe(profileId)
    expect(identity.currentCompany).toBeUndefined()
    expect(identity.rank).toBeUndefined()
    expect(saveOrganization).toBe(true)
    expect(options).toMatchObject({ rankSubmitted: true })
    expect(options.preferences.data.persona).toBe('maritime_enthusiast')
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/home')
  })

  it('saves a profile type change through the preferences rules in the same call, keeping the goals', async () => {
    await expect(updateProfileIdentitySection({}, headerForm({ persona: 'seafarer', rank: 'Chief Officer' }))).resolves.toMatchObject({ success: true })

    const options = mocks.updateIdentity.mock.calls[0]![3]
    expect(options.preferences.data).toMatchObject({ persona: 'seafarer', profileIntents: ['network'], rank: 'Chief Officer' })
  })

  it('asks a Seafarer for the current or most recent rank', async () => {
    const result = await updateProfileIdentitySection({}, headerForm({ persona: 'seafarer', rank: '' }))
    expect(result.fieldErrors?.rank).toEqual(['Add your current or most recent rank.'])
    expect(mocks.updateIdentity).not.toHaveBeenCalled()
  })

  it('keeps a saved institute submitted with a profile type that does not ask for it', async () => {
    mocks.getAwsOwnProfile.mockResolvedValueOnce({ ...enthusiast, persona: 'student_cadet', institutionName: 'IMU Chennai' })
    await updateProfileIdentitySection({}, headerForm({ persona: 'maritime_enthusiast', institutionName: 'IMU Chennai' }))

    const options = mocks.updateIdentity.mock.calls[0]![3]
    expect(options.preferences.retained).toEqual({ institutionName: 'IMU Chennai', communityRelationship: null, specialization: null })
  })

  it('does not give a profile from before personas a persona unless the member changed it', async () => {
    mocks.getAwsOwnProfile.mockResolvedValueOnce({ ...enthusiast, persona: null, profileType: 'seafarer', profileIntents: [] })
    await updateProfileIdentitySection({}, headerForm({ persona: 'seafarer' }))
    expect(mocks.updateIdentity.mock.calls[0]![3]).toEqual({ rankSubmitted: true })
  })

  it('never saves a profile type for organisation accounts', async () => {
    mocks.getAwsOwnProfile.mockResolvedValueOnce({ ...enthusiast, identityRoot: 'organisation', persona: null, profileType: 'company' })
    await updateProfileIdentitySection({}, headerForm({ persona: 'seafarer' }))
    expect(mocks.updateIdentity.mock.calls[0]![3].preferences).toBeUndefined()
  })
})

describe('Access & goals Profile box action', () => {
  function goalsForm(values: Record<string, string>) {
    const form = new FormData()
    for (const [name, value] of Object.entries(values)) form.set(name, value)
    return form
  }

  it('needs at least one goal', async () => {
    const result = await updateProfileGoalsSection({}, goalsForm({ persona: 'maritime_enthusiast', profileIntents: '[]' }))
    expect(result.fieldErrors?.profileIntents?.[0]).toMatch(/at least one/)
    expect(mocks.updateGoals).not.toHaveBeenCalled()
  })

  it('saves the profile type, goals, organization and rank it shows', async () => {
    await expect(updateProfileGoalsSection({}, goalsForm({
      persona: 'maritime_enthusiast',
      profileIntents: JSON.stringify(['learn', 'network']),
      currentCompany: '',
      currentCompanyId: '',
      rank: '',
    }))).resolves.toMatchObject({ success: true })

    expect(mocks.updateGoals).toHaveBeenCalledWith(
      profileId,
      expect.objectContaining({ data: expect.objectContaining({ persona: 'maritime_enthusiast', profileIntents: ['learn', 'network'] }) }),
      { organization: {}, rankSubmitted: true, rank: undefined },
    )
  })
})

describe('Organizations card action', () => {
  function choice(value: string) {
    const form = new FormData()
    form.set('currentOrganization', value)
    return form
  }

  it('sets one of the member\'s organizations as the current one, linked to its page', async () => {
    mocks.listProfileOrganizations.mockResolvedValueOnce([{ id: organizationId, name: 'Harbour Crew', slug: 'harbour-crew' }])
    await expect(updateProfileCurrentOrganization({}, choice(organizationId))).resolves.toMatchObject({ success: true })
    expect(mocks.setCurrentOrganization).toHaveBeenCalledWith(profileId, { currentCompany: 'Harbour Crew', currentCompanyId: organizationId })
  })

  it('refuses an organization the member does not belong to', async () => {
    mocks.listProfileOrganizations.mockResolvedValueOnce([])
    const result = await updateProfileCurrentOrganization({}, choice(organizationId))
    expect(result.fieldErrors?.currentOrganization).toBeDefined()
    expect(mocks.setCurrentOrganization).not.toHaveBeenCalled()
  })

  it('clears the current organization, or keeps the saved one without writing', async () => {
    await updateProfileCurrentOrganization({}, choice('none'))
    expect(mocks.setCurrentOrganization).toHaveBeenCalledWith(profileId, {})
    mocks.setCurrentOrganization.mockClear()
    await expect(updateProfileCurrentOrganization({}, choice('keep'))).resolves.toMatchObject({ success: true })
    expect(mocks.setCurrentOrganization).not.toHaveBeenCalled()
  })
})
