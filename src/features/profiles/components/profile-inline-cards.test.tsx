import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProfileOrganization } from '../organization-link-repository'
import type { ProfileCredentialRecord, ProfileExperienceRecord } from '../profile-portfolio-types'
import type { OwnProfile } from '../types'
import { MaritimeProfileCard } from './maritime-profile-card'
import { ProfileAbout } from './profile-about'
import { ProfileCardEditingProvider } from './profile-card-editing'
import { ProfileCareerTimeline } from './profile-career-timeline'
import { ProfileCredentialWallet } from './profile-credential-wallet'
import { ProfileDgDocumentCard } from './profile-dg-document-card'
import { ProfileHeader } from './profile-header'
import { ProfileMembershipCard } from './profile-membership-card'
import { ProfileOrganizations } from './profile-organizations'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  updateProfileIdentitySection: vi.fn(),
  updateProfileAboutSection: vi.fn(),
  updateProfileProfessionalSection: vi.fn(),
  updateProfileGoalsSection: vi.fn(),
  updateProfileCurrentOrganization: vi.fn(),
  createProfileExperience: vi.fn(),
  updateProfileExperience: vi.fn(),
  deleteProfileExperience: vi.fn(),
  createProfileCredential: vi.fn(),
  updateProfileCredential: vi.fn(),
  deleteProfileCredential: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace, push: mocks.push }),
}))
vi.mock('../profile-inline-actions', () => ({
  updateProfileIdentitySection: mocks.updateProfileIdentitySection,
  updateProfileAboutSection: mocks.updateProfileAboutSection,
  updateProfileProfessionalSection: mocks.updateProfileProfessionalSection,
  updateProfileGoalsSection: mocks.updateProfileGoalsSection,
  updateProfileCurrentOrganization: mocks.updateProfileCurrentOrganization,
}))
vi.mock('../profile-portfolio-actions', () => ({
  createProfileExperience: mocks.createProfileExperience,
  updateProfileExperience: mocks.updateProfileExperience,
  deleteProfileExperience: mocks.deleteProfileExperience,
  createProfileCredential: mocks.createProfileCredential,
  updateProfileCredential: mocks.updateProfileCredential,
  deleteProfileCredential: mocks.deleteProfileCredential,
}))
vi.mock('../username-actions', () => ({
  checkUsernameAvailability: vi.fn(async () => ({ available: true, current: false })),
}))
vi.mock('../profile-document-actions', () => ({
  prepareDgProfileUpload: vi.fn(),
  confirmDgProfileUpload: vi.fn(),
  removeDgProfileUpload: vi.fn(),
}))

/** Aditya: a Maritime Enthusiast with an organization and rank saved by an earlier profile. */
const enthusiast: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'aditya-pratap-singh',
  profileType: 'maritime_professional',
  identityRoot: 'professional',
  persona: 'maritime_enthusiast',
  profileIntents: ['network'],
  fullName: 'Aditya pratap singh',
  avatarPath: null,
  location: 'Lucknow',
  headline: 'Maritime enthusiast',
  summary: 'I follow ships, ports and the people who run them.',
  rank: 'captain',
  currentCompany: 'ig computers',
  currentVessel: null,
  sailingExperienceYears: null,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: ['Ship spotting'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
  usernameChangeCount: 1,
}

const seafarer: OwnProfile = {
  ...enthusiast,
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'captain-example',
  profileType: 'seafarer',
  persona: 'seafarer',
  fullName: 'Captain Example',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
}

const seaService: ProfileExperienceRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  profileId: enthusiast.id,
  track: 'sea_service',
  title: 'Deck Cadet',
  organization: 'Oceanic Shipping',
  vessel: 'MT Horizon',
  vesselType: 'Oil Tanker',
  location: null,
  startedOn: '2015-01-01',
  endedOn: '2016-01-01',
  isCurrent: false,
  description: null,
  cargoExperience: ['Crude Oil'],
  engineExperience: [],
  tradingAreas: ['Worldwide'],
  sortOrder: 0,
}

const credential: ProfileCredentialRecord = {
  id: '44444444-4444-4444-8444-444444444444',
  profileId: enthusiast.id,
  name: 'STCW Basic Safety',
  issuer: 'DG Shipping India',
  credentialNumber: null,
  issuedOn: '2015-01-01',
  expiresOn: null,
  noExpiry: true,
  verificationState: 'self_reported',
  sortOrder: 0,
}

const organizations: ProfileOrganization[] = [
  {
    id: '55555555-5555-4555-8555-555555555555',
    slug: 'harbour-crew',
    name: 'Harbour Crew',
    logoUrl: null,
    verified: true,
    type: 'Ship manager',
    location: 'Mumbai',
    role: 'owner',
    relation: 'manages',
  },
  {
    id: '66666666-6666-4666-8666-666666666666',
    slug: 'blue-anchor',
    name: 'Blue Anchor Marine',
    logoUrl: null,
    verified: false,
    type: null,
    location: null,
    role: 'member',
    relation: 'works_at',
  },
]

const access = {
  personalPlan: 'free',
  personalEntitlements: [],
  verifications: [],
  organizationMemberships: [],
  accountActive: true,
} as unknown as Parameters<typeof ProfileMembershipCard>[0]['access']

function inProvider(children: ReactNode) {
  return <ProfileCardEditingProvider>{children}</ProfileCardEditingProvider>
}

function lastFormData(mock: ReturnType<typeof vi.fn>) {
  const call = mock.mock.calls.at(-1)
  return call?.[call.length - 1] as FormData
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const action of [
    mocks.updateProfileIdentitySection,
    mocks.updateProfileAboutSection,
    mocks.updateProfileProfessionalSection,
    mocks.updateProfileGoalsSection,
    mocks.updateProfileCurrentOrganization,
    mocks.createProfileExperience,
    mocks.updateProfileExperience,
    mocks.createProfileCredential,
    mocks.updateProfileCredential,
  ]) action.mockResolvedValue({ success: true, revision: 1 })
  mocks.deleteProfileExperience.mockResolvedValue({ success: true })
  mocks.deleteProfileCredential.mockResolvedValue({ success: true })
})

afterEach(() => cleanup())

describe('header card (round 11)', () => {
  it('shows every value the header shows, including a saved organization and rank for a Maritime Enthusiast', () => {
    render(inProvider(<ProfileHeader profile={enthusiast} editHref="inline" contactVisibility="public" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))

    expect(screen.getByRole('combobox', { name: 'Profile type' })).toHaveValue('maritime_enthusiast')
    expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue('Aditya pratap singh')
    expect(screen.getByRole('textbox', { name: /Username/ })).toHaveValue('aditya-pratap-singh')
    expect(screen.getByText('Username changes remaining: 1 of 2.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Maritime enthusiast')
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('Lucknow')
    expect(screen.getByRole('combobox', { name: 'Current organization' })).toHaveValue('ig computers')
    expect(screen.getByRole('textbox', { name: /Rank or role/ })).toHaveValue('captain')
    expect(screen.getByRole('combobox', { name: 'Contact visibility' })).toHaveValue('public')
    // The header's own photo buttons are untouched; no link leaves for /profile/edit.
    expect(document.querySelector('a[href^="/profile/edit"]')).toBeNull()
  })

  it('lets a Maritime Enthusiast clear the saved organization and rank, then returns to view mode', async () => {
    render(inProvider(<ProfileHeader profile={enthusiast} editHref="inline" />))
    const pencil = screen.getByRole('button', { name: 'Edit basic information' })
    fireEvent.click(pencil)
    fireEvent.change(screen.getByRole('combobox', { name: 'Current organization' }), { target: { value: '' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Rank or role/ }), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateProfileIdentitySection).toHaveBeenCalledTimes(1))
    const data = lastFormData(mocks.updateProfileIdentitySection)
    expect(data.get('rank')).toBe('')
    expect(data.get('currentCompany')).toBe('')
    expect(data.get('persona')).toBe('maritime_enthusiast')
    await waitFor(() => expect(screen.queryByRole('form', { name: 'Edit basic information' })).not.toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Edit basic information' })).toHaveFocus()
  })

  it('shows and hides the persona fields live as the profile type changes, the way onboarding does', () => {
    const fresh: OwnProfile = { ...enthusiast, rank: null, currentCompany: null }
    render(inProvider(<ProfileHeader profile={fresh} editHref="inline" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    const type = screen.getByRole('combobox', { name: 'Profile type' })

    expect(screen.queryByRole('textbox', { name: /rank/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Current organization' })).not.toBeInTheDocument()

    fireEvent.change(type, { target: { value: 'seafarer' } })
    expect(screen.getByRole('textbox', { name: /Current or most recent rank/ })).toBeRequired()
    expect(screen.getByRole('combobox', { name: 'Current organization' })).toBeInTheDocument()

    fireEvent.change(type, { target: { value: 'student_cadet' } })
    expect(screen.getByRole('textbox', { name: 'Institute / academy' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /rank/i })).not.toBeInTheDocument()

    fireEvent.change(type, { target: { value: 'seafarer_family' } })
    expect(screen.getByRole('textbox', { name: 'Relationship to the maritime community' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Institute / academy' })).not.toBeInTheDocument()

    fireEvent.change(type, { target: { value: 'trainer_instructor' } })
    expect(screen.getByRole('textbox', { name: 'Training specialization' })).toBeInTheDocument()

    fireEvent.change(type, { target: { value: 'maritime_enthusiast' } })
    expect(screen.queryByRole('textbox', { name: 'Training specialization' })).not.toBeInTheDocument()
  })

  it('keeps a saved value visible when the new profile type does not ask for it', () => {
    render(inProvider(<ProfileHeader profile={{ ...enthusiast, institutionName: 'IMU Chennai' }} editHref="inline" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    expect(screen.getByRole('textbox', { name: 'Institute / academy' })).toHaveValue('IMU Chennai')
    fireEvent.change(screen.getByRole('combobox', { name: 'Profile type' }), { target: { value: 'seafarer' } })
    expect(screen.getByRole('textbox', { name: 'Institute / academy' })).toHaveValue('IMU Chennai')
    expect(screen.getByRole('textbox', { name: /Current or most recent rank/ })).toHaveValue('captain')
  })

  it('never gives organisation accounts a profile type, organization or rank field', () => {
    render(inProvider(<ProfileHeader profile={{ ...enthusiast, identityRoot: 'organisation', persona: null, profileType: 'company' }} editHref="inline" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    expect(screen.queryByRole('combobox', { name: 'Profile type' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Current organization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: /rank/i })).not.toBeInTheDocument()
  })

  it('shows "Saving…" and disables both buttons while saving, and shows errors inline under the field', async () => {
    let finish: (value: unknown) => void = () => {}
    mocks.updateProfileIdentitySection.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
    render(inProvider(<ProfileHeader profile={enthusiast} editHref="inline" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    const saving = await screen.findByRole('button', { name: 'Saving…' })
    expect(saving).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()

    await act(async () => finish({ fieldErrors: { headline: ['Add a professional headline.'] }, revision: 1 }))
    const headline = screen.getByRole('textbox', { name: /^Headline/ })
    expect(headline.closest('label')).toHaveTextContent('Add a professional headline.')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })
})

describe('Cancel and Esc', () => {
  it('Cancel restores the saved values and returns focus to the pencil', () => {
    render(inProvider(<ProfileAbout profile={enthusiast} editHref="inline" />))
    const pencil = screen.getByRole('button', { name: 'Edit About' })
    fireEvent.click(pencil)
    fireEvent.change(screen.getByRole('textbox', { name: 'About' }), { target: { value: 'Something else entirely, not saved.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.getByText(enthusiast.summary!)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit About' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Edit About' }))
    expect(screen.getByRole('textbox', { name: 'About' })).toHaveValue(enthusiast.summary)
    expect(mocks.updateProfileAboutSection).not.toHaveBeenCalled()
  })

  it('Esc cancels the open card', () => {
    render(inProvider(<MaritimeProfileCard profile={seafarer} editHref="inline" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Professional Record' }))
    const rank = screen.getByRole('textbox', { name: 'Rank' })
    fireEvent.change(rank, { target: { value: 'Chief Officer' } })
    fireEvent.keyDown(rank, { key: 'Escape' })

    expect(screen.queryByRole('textbox', { name: 'Rank' })).not.toBeInTheDocument()
    expect(screen.getByText('Master')).toBeInTheDocument()
    expect(mocks.updateProfileProfessionalSection).not.toHaveBeenCalled()
  })

  it('Save on About and Maritime Experience calls their own actions and returns to view mode', async () => {
    render(inProvider(
      <>
        <ProfileAbout profile={seafarer} editHref="inline" />
        <MaritimeProfileCard profile={seafarer} editHref="inline" />
      </>,
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Edit About' }))
    expect(screen.getByRole('textbox', { name: 'Skills' })).toHaveValue('Ship spotting')
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.updateProfileAboutSection).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'About' })).not.toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: 'Edit Professional Record' }))
    for (const [name, value] of [['Rank', 'Master'], ['Current vessel', 'MT Example'], ['Vessel types', 'Oil Tanker'], ['Trading areas', 'Worldwide']]) {
      expect(screen.getByRole('textbox', { name })).toHaveValue(value)
    }
    expect(screen.getByRole('spinbutton', { name: 'Sailing experience years' })).toHaveValue(18)
    expect(screen.getByRole('checkbox', { name: 'Interested in shore opportunities' })).toBeChecked()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.updateProfileProfessionalSection).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Rank' })).not.toBeInTheDocument())
  })
})

describe('one card at a time', () => {
  function renderCards() {
    return render(inProvider(
      <>
        <ProfileHeader profile={seafarer} editHref="inline" />
        <ProfileAbout profile={seafarer} editHref="inline" />
        <MaritimeProfileCard profile={seafarer} editHref="inline" />
      </>,
    ))
  }

  it('switches straight away when the open card has no changes', () => {
    renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Edit About' }))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Professional Record' }))
    expect(screen.queryByRole('textbox', { name: 'About' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Rank' })).toBeInTheDocument()
    expect(screen.queryByTestId('profile-discard-prompt')).not.toBeInTheDocument()
  })

  it('asks in the page before discarding unsaved changes: Keep editing or Discard', () => {
    const confirm = vi.spyOn(window, 'confirm')
    renderCards()
    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Headline' }), { target: { value: 'Master Mariner | LNG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Edit About' }))

    const prompt = screen.getByRole('alertdialog', { name: 'Discard changes to Basic information?' })
    expect(confirm).not.toHaveBeenCalled()
    fireEvent.click(within(prompt).getByRole('button', { name: 'Keep editing' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Master Mariner | LNG')
    expect(screen.queryByRole('textbox', { name: 'About' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit About' }))
    fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Discard' }))
    expect(screen.queryByRole('textbox', { name: 'Headline' })).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'About' })).toBeInTheDocument()
    confirm.mockRestore()
  })
})

describe('someone else\'s profile', () => {
  it('has no pencils, plus buttons or edit mode on any card', () => {
    render(
      <>
        <ProfileHeader profile={seafarer} />
        <ProfileAbout profile={seafarer} />
        <MaritimeProfileCard profile={seafarer} />
        <ProfileOrganizations organizations={organizations} />
        <ProfileCareerTimeline experiences={[seaService]} />
        <ProfileCredentialWallet credentials={[credential]} />
      </>,
    )
    expect(screen.queryAllByRole('button', { name: /^(Edit|Add)\b/ })).toHaveLength(0)
    expect(document.querySelector('form')).toBeNull()
  })
})

describe('Organizations card', () => {
  it('chooses the current organization in place, keeps each organization linked and offers admins their manage page', async () => {
    render(inProvider(
      <ProfileOrganizations organizations={organizations} editable current={{ name: 'ig computers', organization: null }} />,
    ))
    expect(screen.getByRole('link', { name: /Harbour Crew/ })).toHaveAttribute('href', '/organizations/harbour-crew')
    expect(screen.queryByRole('link', { name: 'Manage organizations' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Edit organizations' }))
    expect(screen.getByRole('radio', { name: /Keep “ig computers”/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /Harbour Crew/ })).not.toBeChecked()
    expect(screen.getByRole('radio', { name: /Don’t show an organization/ })).toBeInTheDocument()
    const manage = screen.getAllByRole('link', { name: /Manage on organization page/ })
    expect(manage).toHaveLength(1)
    expect(manage[0]).toHaveAttribute('href', '/organizations/harbour-crew/manage')

    fireEvent.click(screen.getByRole('radio', { name: /Blue Anchor Marine/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(mocks.updateProfileCurrentOrganization).toHaveBeenCalledTimes(1))
    expect(lastFormData(mocks.updateProfileCurrentOrganization).get('currentOrganization')).toBe('66666666-6666-4666-8666-666666666666')
    await waitFor(() => expect(screen.queryByRole('radio', { name: /Blue Anchor Marine/ })).not.toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('marks a linked current organization that the member belongs to', () => {
    render(inProvider(
      <ProfileOrganizations
        organizations={organizations}
        editable
        current={{ name: 'Harbour Crew', organization: { id: organizations[0]!.id, slug: 'harbour-crew', name: 'Harbour Crew', logoUrl: null, verified: true } }}
      />,
    ))
    fireEvent.click(screen.getByRole('button', { name: 'Edit organizations' }))
    expect(screen.getByRole('radio', { name: /Harbour Crew/ })).toBeChecked()
    expect(screen.queryByRole('radio', { name: /Keep/ })).not.toBeInTheDocument()
  })
})

describe('Access & goals Profile box', () => {
  it('edits the profile type and goal chips in place; Plan and Verifications only link to Settings', async () => {
    render(inProvider(<ProfileMembershipCard profile={enthusiast} access={access} />))
    expect(screen.queryByRole('link', { name: 'Edit profile & goals' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Manage plan' })).toHaveAttribute('href', '/settings/billing')
    expect(screen.getByRole('link', { name: 'Manage verifications' })).toHaveAttribute('href', '/settings/verifications')
    expect(screen.getAllByRole('button', { name: /^Edit/ })).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Edit profile type and goals' }))
    expect(screen.getByRole('combobox', { name: 'Profile type' })).toHaveValue('maritime_enthusiast')
    expect(screen.getByRole('button', { name: /Network/ })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: /Network/ }))
    expect(screen.getByText('Choose at least one goal.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /Learn/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(mocks.updateProfileGoalsSection).toHaveBeenCalledTimes(1))
    const data = lastFormData(mocks.updateProfileGoalsSection)
    expect(data.get('persona')).toBe('maritime_enthusiast')
    expect(JSON.parse(String(data.get('profileIntents')))).toEqual(['learn'])
    await waitFor(() => expect(screen.queryByRole('combobox', { name: 'Profile type' })).not.toBeInTheDocument())
  })
})

describe('Experience follows the profile type', () => {
  it('a Maritime Enthusiast adds a "Work / other role" without vessel fields', () => {
    render(inProvider(<ProfileCareerTimeline experiences={[]} editable persona="maritime_enthusiast" />))
    fireEvent.click(screen.getByRole('button', { name: 'Add experience' }))
    const type = screen.getByRole('combobox', { name: 'Experience type' })
    expect(type).toHaveValue('other_maritime')
    expect(within(type).getByRole('option', { name: 'Work / other role' })).toBeInTheDocument()
    expect(within(type).queryByRole('option', { name: 'Sea service' })).not.toBeInTheDocument()
    for (const label of ['Vessel', 'Vessel type', 'Cargo experience', 'Engine experience', 'Trading areas']) {
      expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    }
    expect(screen.getByLabelText('Job title')).toBeInTheDocument()
    expect(screen.getByLabelText('Organization')).toBeInTheDocument()
    expect(screen.getByLabelText('Location')).toBeInTheDocument()
    expect(screen.getByLabelText('I work here now')).toBeInTheDocument()
  })

  it('training shows course, institute, dates and description', () => {
    render(inProvider(<ProfileCareerTimeline experiences={[]} editable persona="trainer_instructor" />))
    fireEvent.click(screen.getByRole('button', { name: 'Add experience' }))
    expect(screen.getByRole('combobox', { name: 'Experience type' })).toHaveValue('training')
    expect(screen.getByLabelText('Course / programme')).toBeInTheDocument()
    expect(screen.getByLabelText('Institute')).toBeInTheDocument()
    expect(screen.getByLabelText('Start date')).toBeInTheDocument()
    expect(screen.getByLabelText('End date')).toBeInTheDocument()
    expect(screen.getByLabelText('Description')).toBeInTheDocument()
    expect(screen.queryByLabelText('Location')).not.toBeInTheDocument()
  })

  it('shore personas default to a shore role', () => {
    render(inProvider(<ProfileCareerTimeline experiences={[]} editable persona="recruiter_hr" />))
    fireEvent.click(screen.getByRole('button', { name: 'Add experience' }))
    expect(screen.getByRole('combobox', { name: 'Experience type' })).toHaveValue('shore_role')
  })

  it('a Seafarer still defaults to Sea service with vessel fields', () => {
    render(inProvider(<ProfileCareerTimeline experiences={[]} editable persona="seafarer" />))
    fireEvent.click(screen.getByRole('button', { name: 'Add experience' }))
    expect(screen.getByRole('combobox', { name: 'Experience type' })).toHaveValue('sea_service')
    expect(screen.getByLabelText('Vessel')).toBeInTheDocument()
    expect(screen.getByLabelText('Cargo experience')).toBeInTheDocument()
  })

  it('an existing sea-service record stays editable, with its fields, for any profile type', async () => {
    render(inProvider(<ProfileCareerTimeline experiences={[seaService]} editable persona="maritime_enthusiast" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Deck Cadet' }))
    expect(screen.getByRole('combobox', { name: 'Experience type' })).toHaveValue('sea_service')
    expect(screen.getByLabelText('Vessel')).toHaveValue('MT Horizon')
    expect(screen.getByLabelText('Cargo experience')).toHaveValue('Crude Oil')
    fireEvent.click(screen.getByRole('button', { name: 'Save experience' }))
    await waitFor(() => expect(mocks.updateProfileExperience).toHaveBeenCalledWith(seaService.id, expect.anything(), expect.any(FormData)))
    await waitFor(() => expect(screen.queryByLabelText('Vessel')).not.toBeInTheDocument())
  })

  it('deletes an item in place after confirming', async () => {
    render(inProvider(<ProfileCareerTimeline experiences={[seaService]} editable persona="seafarer" />))
    fireEvent.click(screen.getByRole('button', { name: 'Edit Deck Cadet' }))
    fireEvent.click(screen.getByRole('button', { name: 'Delete Deck Cadet' }))
    expect(mocks.deleteProfileExperience).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Delete experience' }))
    await waitFor(() => expect(mocks.deleteProfileExperience).toHaveBeenCalledWith(seaService.id))
  })
})

describe('Licences & Credentials follow the profile type', () => {
  it('is not shown to a Maritime Enthusiast or a Seafarer Family member without credentials', () => {
    const { rerender } = render(inProvider(<ProfileCredentialWallet credentials={[]} editable persona="maritime_enthusiast" />))
    expect(screen.queryByRole('heading', { name: 'Licences & Credentials' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add credential/ })).not.toBeInTheDocument()
    rerender(inProvider(<ProfileCredentialWallet credentials={[]} editable persona="seafarer_family" />))
    expect(screen.queryByRole('heading', { name: 'Licences & Credentials' })).not.toBeInTheDocument()
  })

  it('keeps saved credentials editable for them, without an Add button', () => {
    render(inProvider(<ProfileCredentialWallet credentials={[credential]} editable persona="maritime_enthusiast" />))
    expect(screen.getByRole('heading', { name: 'Licences & Credentials' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add credential/ })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit STCW Basic Safety' }))
    expect(screen.getByLabelText('Certificate / CoC name')).toHaveValue('STCW Basic Safety')
    expect(screen.getByRole('button', { name: 'Delete STCW Basic Safety' })).toBeInTheDocument()
  })

  it('keeps the card and its Add button for working personas', () => {
    for (const persona of ['seafarer', 'shore_professional', 'recruiter_hr', 'trainer_instructor', 'student_cadet'] as const) {
      const { unmount } = render(inProvider(<ProfileCredentialWallet credentials={[]} editable persona={persona} />))
      expect(screen.getByRole('button', { name: 'Add credential' })).toBeInTheDocument()
      unmount()
    }
  })
})

describe('DG profile card', () => {
  it('uses its pencil for upload, replace and remove in place, and Done returns to view mode', () => {
    render(inProvider(<ProfileDgDocumentCard profileId={seafarer.id} document={null} />))
    expect(screen.queryByRole('button', { name: 'Add DG profile PDF' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Edit DG Shipping profile' }))
    expect(screen.getByRole('button', { name: 'Add DG profile PDF' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(screen.queryByRole('button', { name: 'Add DG profile PDF' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit DG Shipping profile' })).toHaveFocus()
  })
})

describe('back from registering an organization', () => {
  it('opens the header editor once with the new organization linked, and Cancel closes it for good', () => {
    const registered = { id: '77777777-7777-4777-8777-777777777777', name: 'Blue Anchor Marine', pending: true }
    render(inProvider(<ProfileHeader profile={enthusiast} editHref="inline" registeredOrganization={registered} />))
    expect(screen.getByRole('combobox', { name: 'Current organization' })).toHaveValue('Blue Anchor Marine')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('combobox', { name: 'Current organization' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit basic information' })).toBeInTheDocument()
  })
})
