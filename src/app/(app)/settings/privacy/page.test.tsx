import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getOwnProfile: vi.fn(),
  get: vi.fn(),
  getChoices: vi.fn(),
  setPrivacyPreference: vi.fn(),
  setPrivacyChoice: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: mocks.getOwnProfile }))
vi.mock('@/features/profiles/privacy-actions', () => ({
  setPrivacyPreference: mocks.setPrivacyPreference,
  setPrivacyChoice: mocks.setPrivacyChoice,
}))
vi.mock('@/features/profiles/privacy-preferences', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/profiles/privacy-preferences')>()
  return { ...actual, privacyPreferences: { get: mocks.get, getChoices: mocks.getChoices } }
})
vi.mock('@/components/navigation/mobile-page-bar', () => ({ MobilePageBar: () => null }))

import PrivacySettingsPage from './page'

/** Round H (H5): "Let search engines show my profile" on Settings › Privacy. */
describe('Settings › Privacy: search engines', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.getOwnProfile.mockResolvedValue({ persona: 'seafarer' })
    mocks.get.mockResolvedValue({ showInPeopleSuggestions: true, openToRecruiters: false, allowSearchIndexing: false })
    mocks.getChoices.mockResolvedValue({ messagePermission: 'everyone', connectionsVisibility: 'everyone' })
    mocks.setPrivacyPreference.mockResolvedValue({ ok: true, value: true })
  })

  afterEach(() => cleanup())

  function searchSwitch() {
    const section = screen.getByRole('region', { name: 'Search engines' })
    expect(section).toHaveTextContent('Your public profile page can appear in Google and other search engines. Off: search engines are asked not to list it.')
    return within(section).getByRole('switch', { name: /Let search engines show my profile/ })
  }

  it('shows the switch off by default and saves allowSearchIndexing when turned on', async () => {
    render(await PrivacySettingsPage())

    const toggle = searchSwitch()
    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)

    await waitFor(() => expect(mocks.setPrivacyPreference).toHaveBeenCalledWith('allowSearchIndexing', true))
    expect(await screen.findByText('Search engines may now show your profile.')).toBeInTheDocument()
  })

  it('shows the saved choice, and off when the preferences cannot be read', async () => {
    mocks.get.mockResolvedValueOnce({ showInPeopleSuggestions: true, openToRecruiters: false, allowSearchIndexing: true })
    render(await PrivacySettingsPage())
    expect(searchSwitch()).toBeChecked()
    cleanup()

    mocks.get.mockRejectedValueOnce(new Error('db down'))
    render(await PrivacySettingsPage())
    expect(searchSwitch()).not.toBeChecked()
  })
})
