import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { isValidElement, type ReactNode } from 'react'
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
import { PrivacyChoice } from './privacy-choice'
import { PrivacyToggle } from './privacy-toggle'

/** Every prop the page passes to one of these Client Components, found by walking the page's element tree. */
function clientProps(node: ReactNode, clientComponents: readonly unknown[], found: Array<{ name: string; props: Record<string, unknown> }> = []) {
  if (Array.isArray(node)) {
    for (const child of node) clientProps(child, clientComponents, found)
  } else if (isValidElement<Record<string, unknown>>(node)) {
    if (clientComponents.includes(node.type)) found.push({ name: (node.type as { name: string }).name, props: node.props })
    clientProps(node.props.children as ReactNode, clientComponents, found)
  }
  return found
}

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

/**
 * Hotfix (Oct 2026): the page failed on every load in production (React error #441) because it passed a function
 * (savedMessage) to PrivacyChoice, a Client Component. React only passes plain data across that boundary. Rendering
 * in a test does not go through that boundary, so this checks the props themselves.
 */
describe('Settings › Privacy: Server Component to Client Component props', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    mocks.getOwnProfile.mockResolvedValue({ persona: 'seafarer' })
    mocks.get.mockResolvedValue({ showInPeopleSuggestions: true, openToRecruiters: false, allowSearchIndexing: false })
    mocks.getChoices.mockResolvedValue({ messagePermission: 'everyone', connectionsVisibility: 'everyone' })
    mocks.setPrivacyChoice.mockResolvedValue({ ok: true })
  })

  afterEach(() => cleanup())

  it('passes only plain data to the privacy Client Components', async () => {
    const found = clientProps(await PrivacySettingsPage(), [PrivacyChoice, PrivacyToggle])
    // Three switches (suggestions, open to recruiters, search engines) and two choices.
    expect(found.map((component) => component.name).sort()).toEqual(['PrivacyChoice', 'PrivacyChoice', 'PrivacyToggle', 'PrivacyToggle', 'PrivacyToggle'])
    for (const { name, props } of found) {
      // structuredClone throws on functions, symbols and class instances React cannot send either.
      expect(() => structuredClone(props), `${name} ${String(props.setting)}`).not.toThrow()
    }
  })

  it('says what was saved: the special message for Nobody, otherwise the chosen label', async () => {
    render(await PrivacySettingsPage())

    fireEvent.click(screen.getByRole('radio', { name: 'Nobody' }))
    await waitFor(() => expect(mocks.setPrivacyChoice).toHaveBeenCalledWith('messagePermission', 'nobody'))
    expect(await screen.findByText('Nobody can message you now.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('radio', { name: 'Only me' }))
    await waitFor(() => expect(mocks.setPrivacyChoice).toHaveBeenCalledWith('connectionsVisibility', 'only_me'))
    expect(await screen.findByText('Saved: Only me.')).toBeInTheDocument()
  })
})
