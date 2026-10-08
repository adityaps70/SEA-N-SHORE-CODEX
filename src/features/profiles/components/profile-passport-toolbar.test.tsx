import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ProfileIdentityEditorContext } from './profile-header'
import { ProfilePassportToolbar } from './profile-passport-toolbar'

vi.mock('./profile-share-controls', () => ({
  ProfileShareControls: ({ slug, siteUrl }: { slug: string; siteUrl?: string }) => (
    <div data-testid="profile-share-controls">{slug}:{siteUrl ?? ''}</div>
  ),
}))

afterEach(() => cleanup())

describe('ProfilePassportToolbar', () => {
  it('uses the real share and QR controls while keeping public profile and CV actions', () => {
    render(<ProfilePassportToolbar slug="captain-example" siteUrl="https://seaandshore.in" />)

    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveAttribute('href', '/people/captain-example')
    expect(screen.getByTestId('profile-share-controls')).toHaveTextContent('captain-example:https://seaandshore.in')
    expect(screen.getByRole('link', { name: /download cv/i })).toHaveAttribute('href', '/api/profile/cv')
    // Settings lives in the account menu; the profile toolbar no longer duplicates it.
    expect(screen.queryByRole('link', { name: /settings/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /qr profile/i })).not.toBeInTheDocument()
  })
})

describe('ProfilePassportToolbar phone "…" sheet', () => {
  it('keeps Share and QR on phones and moves the other owner actions into the sheet', () => {
    render(<ProfilePassportToolbar slug="captain-example" />)

    // Desktop-only buttons are hidden below md; the "…" trigger is phone-only.
    expect(screen.getByRole('link', { name: /view public profile/i })).toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: /download cv/i })).toHaveClass('max-md:hidden')
    const more = screen.getByRole('button', { name: 'More profile actions' })
    expect(more).toHaveClass('md:hidden')

    fireEvent.click(more)
    const sheet = screen.getByRole('menu', { name: 'More profile actions' })
    const items = within(sheet).getAllByRole('menuitem')
    // Without the header's in-place editor (not the owner's header) there is no edit row, and
    // nothing in the sheet leaves for /profile/edit (round 11).
    expect(items.map((item) => item.textContent)).toEqual([
      'View public profile',
      'Download CV',
    ])
    expect(within(sheet).getByRole('menuitem', { name: 'View public profile' })).toHaveAttribute('href', '/people/captain-example')
    expect(within(sheet).getByRole('menuitem', { name: 'Download CV' })).toHaveAttribute('href', '/api/profile/cv')
    for (const item of items) expect(item.getAttribute('href') ?? '').not.toContain('/profile/edit')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'More profile actions' })).not.toBeInTheDocument()
  })

  it('opens the header card\'s inline editor (username and contact visibility included) from "Edit profile"', () => {
    const openEditor = vi.fn()
    render(
      <ProfileIdentityEditorContext.Provider value={openEditor}>
        <ProfilePassportToolbar slug="captain-example" />
      </ProfileIdentityEditorContext.Provider>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'More profile actions' }))
    const edit = screen.getByRole('menuitem', { name: /Edit profile/ })
    expect(edit).toHaveTextContent('username')
    expect(edit).toHaveTextContent('contact visibility')
    expect(edit).not.toHaveAttribute('href')
    fireEvent.click(edit)
    expect(openEditor).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu', { name: 'More profile actions' })).not.toBeInTheDocument()
  })
})
